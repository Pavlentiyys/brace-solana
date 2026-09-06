"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { AuthorizeScreen } from "@/components/app/authorize-screen";
import { ConnectGate, PositionList } from "@/components/app/connect";
import { FailureNotice } from "@/components/app/failure-notice";
import { HistoryScreen } from "@/components/app/history-screen";
import { Panel } from "@/components/app/panel";
import { RepayNow } from "@/components/app/repay-now";
import { ReserveScreen } from "@/components/app/reserve-screen";
import { ScheduleScreen } from "@/components/app/schedule-screen";
import { OpenPosition } from "@/components/app/open-position";
import { ActionProposal } from "@/components/chat/action-proposal";
import { ThreadList } from "@/components/chat/thread-list";
import { Note } from "@/components/app/ui";
import { Bubble, Thinking } from "@/components/chat/message";
import { en } from "@/content/en";
import { commandByName, matchCommand, type CommandName } from "@/lib/chat/commands";
import {
  available,
  greeting,
  reply,
  type ChatBlock,
  type ChatContext,
  type ChatMessage,
} from "@/lib/chat/engine";
import {
  activeThread,
  deleteThread,
  getServerSnapshot,
  getSnapshot,
  selectThread,
  setMessages,
  startThread,
  subscribe,
} from "@/lib/chat/store";
import type { ProposedAction, RepayNowAction } from "@/lib/chat/actions";
import { newId, type Thread } from "@/lib/chat/threads";
import { positionLtvBps } from "@/lib/core/position";
import { usePlatform, useSelectedPosition } from "@/lib/platform/provider";

const MAX_API_CONTENT_LENGTH = 6_000;

/**
 * The app as a conversation.
 *
 * The screens did not go away; they are what the bot answers with. A question about
 * risk returns the position panel, not a paragraph describing it, because the panel
 * is already the honest rendering of that data and a sentence restating it is a
 * second implementation that can drift.
 *
 * Conversations are kept in this browser so a list of them survives a reload — see
 * `lib/chat/threads.ts` for what that stores and what it costs. Free-form questions
 * go through the server-side Anthropic route; the API key never enters this bundle
 * and nothing is sent anywhere else.
 */


function apiContent(message: ChatMessage): string {
  return message.blocks
    .filter((block): block is Extract<ChatBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("\n\n");
}

function isBlockedRouterHtml(content: string): boolean {
  return /aliyun_waf_|access verification|aliyuncaptcha|slide to complete/i.test(content);
}

function useChatContext(): ChatContext {
  const { status, world, wallet, config, source } = usePlatform();
  const { snapshot, entry, failure, isLoading } = useSelectedPosition();

  return useMemo(() => {
    const guard = entry?.guard ?? null;
    const position = entry?.position ?? null;

    return {
      connected: status === "connected",
      world,
      walletKind: wallet.kind,
      clusterLabel: config.clusterLabel,
      positionCount: isLoading && !snapshot ? null : (snapshot?.positions.length ?? 0),
      supportedCount: snapshot?.positions.filter((candidate) => candidate.supported).length ?? 0,
      hasGuard: guard !== null,
      paused: guard?.paused ?? false,
      ltvBps: position ? positionLtvBps(position) : null,
      triggerBps: guard?.policy.triggerLtvBps ?? null,
      liquidationBps: position?.liquidationLtvBps ?? null,
      refreshed: position?.refreshed ?? true,
      failure,
      canAct: source.canWrite,
    };
  }, [status, world, wallet.kind, config.clusterLabel, snapshot, entry, failure, isLoading, source]);
}

function Block({
  block,
  onOpenPosition,
}: {
  block: ChatBlock;
  onOpenPosition: (obligation: string) => void;
}) {
  switch (block.kind) {
    case "text":
      return <p className="text-[13px] leading-relaxed text-ink">{block.text}</p>;
    case "connect":
      return <ConnectGate>{null}</ConnectGate>;
    case "positions":
      return <PositionList onOpen={onOpenPosition} />;
    case "openPosition":
      return <OpenPosition />;
    case "proposal":
      return <ActionProposal action={block.action} />;
    case "status":
      return <Panel />;
    case "reserve":
      return <ReserveScreen />;
    case "repayNow":
      return <RepayNow />;
    case "schedule":
      return <ScheduleScreen />;
    case "authorize":
      return <AuthorizeScreen />;
    case "history":
      return <HistoryScreen />;
    case "failure":
      return <FailureNotice failure={block.failure} />;
  }
}

function Chips({
  names,
  onPick,
}: {
  names: CommandName[];
  onPick: (name: CommandName) => void;
}) {
  if (names.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onPick(name)}
          className="min-h-9 rounded-panel border border-line px-3 text-[12px] text-ink-dim transition-colors duration-300 hover:border-accent hover:text-ink"
        >
          {commandByName(name).label}
        </button>
      ))}
    </div>
  );
}

/**
 * One conversation: the transcript, the chips and the composer.
 *
 * The opening greeting is derived while the thread is empty, so "reading your
 * positions" becomes the real count as soon as the read lands. It is written into
 * the thread on the first send, because rewriting a message somebody has already
 * scrolled past is worse than an opening that is one state behind.
 */
function Conversation({
  thread,
  context,
  arriving,
  pending,
  onSend,
  onOpenPosition,
}: {
  thread: Thread;
  context: ChatContext;
  arriving: ReadonlySet<string>;
  pending: boolean;
  onSend: (input: string, opening: ChatMessage) => void;
  onOpenPosition: (obligation: string, opening: ChatMessage) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  const opening: ChatMessage = useMemo(
    () => ({ id: `${thread.id}-opening`, role: "bot", at: thread.createdAt, ...greeting(context) }),
    [thread.id, thread.createdAt, context],
  );

  const messages = useMemo(
    () => (thread.messages.length === 0 ? [opening] : thread.messages),
    [thread.messages, opening],
  );

  /**
   * Keep the newest message in view while it is still growing.
   *
   * Scrolling once when the message count changes was not enough: an answer
   * carrying a rich block renders its text first and the block a frame later,
   * so the scroll landed above content that had not been laid out yet and the
   * answer stayed under the fold. Watching the content's size instead follows
   * it until it settles.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = scroller?.firstElementChild;
    if (!scroller || !content) return;

    const pin = () => {
      scroller.scrollTop = scroller.scrollHeight;
    };

    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    return () => observer.disconnect();
  }, [messages.length, pending, thread.id]);

  function submit(input: string) {
    if (input.trim() === "" || pending) return;
    onSend(input, opening);
    setDraft("");
  }

  const last = messages[messages.length - 1];
  const chips =
    last?.role === "bot" && last.suggestions.length > 0
      ? last.suggestions
      : available(context).slice(0, 4);

  return (
    // The messages scroll, the composer does not. It used to be `sticky
    // bottom-0` inside a page that scrolled as a whole, which pinned it over
    // the last answer whenever the conversation was shorter than the viewport.
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-6 pb-6">
          {messages.map((message) => (
            <Bubble
              key={message.id}
              message={message}
              animate={arriving.has(message.id)}
              renderBlock={(block) => (
                <Block
                  block={block}
                  onOpenPosition={(obligation) => onOpenPosition(obligation, opening)}
                />
              )}
            />
          ))}
          {pending ? <Thinking /> : null}
        </div>
      </div>

      {/*
        The composer had `bg-base`, which is not a token in this theme — only
        canvas, surface and raised are — so it rendered with no background at all
        and the transcript scrolled straight through it. It is a panel now: a fade
        so messages dissolve rather than being cut, an opaque strip under it, and
        the controls on `surface` a step above the canvas behind them.
      */}
      <div className="flex shrink-0 flex-col border-t border-line">
        <div className="bg-canvas pt-4">
          <div className="flex flex-col gap-3 rounded-panel border border-line-strong bg-surface p-4 shadow-[0_2px_28px_rgba(0,0,0,0.55)]">
            <Chips names={chips} onPick={(name) => submit(`/${name}`)} />

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit(draft);
              }}
              className="flex items-center gap-3"
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={en.app.chat.placeholder}
                aria-label={en.app.chat.inputLabel}
                className="min-h-11 flex-1 rounded-panel border border-line bg-canvas px-4 text-[13px] text-ink outline-none transition-colors duration-300 placeholder:text-ink-faint focus:border-accent"
              />
              <button
                type="submit"
                disabled={draft.trim() === "" || pending}
                className="min-h-11 rounded-panel border border-line-strong bg-raised px-4 text-[13px] text-ink transition-colors duration-300 hover:border-accent disabled:opacity-40"
              >
                {pending ? "Thinking…" : en.app.chat.send}
              </button>
            </form>

            <Note>{en.app.chat.note}</Note>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Chat() {
  const context = useChatContext();
  const { select } = usePlatform();
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const thread = activeThread(state);

  /**
   * Undo rather than a confirmation dialog.
   *
   * A dialog stops the user on every delete, including the deliberate ones,
   * and most deletes are deliberate. An undo costs nothing when the click was
   * meant and recovers the conversation when it was not. The browser is the
   * only copy, so recovery has to exist somewhere.
   */
  const [undo, setUndo] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  function remove(id: string) {
    const restore = deleteThread(id);
    setUndo(() => restore);
  }

  /**
   * Which messages should play an arrival.
   *
   * Recorded when a message is created rather than derived at render. This panel
   * re-renders on every snapshot poll, so anything computed here would retype
   * somebody's liquidation figure once a second. It is also why nothing restored
   * from storage animates: those ids were never added to this set.
   */
  const [arriving, setArriving] = useState<ReadonlySet<string>>(new Set());
  const [pendingIn, setPendingIn] = useState<string | null>(null);

  // One clock for the whole list, so twenty rows agree on "3m ago" and none of them
  // re-renders on a timer of its own.
  const [now] = useState(() => Date.now());

  if (thread === null) {
    // Only reachable during the server render, where the store is deliberately empty.
    return null;
  }

  const pending = pendingIn === thread.id;

  function remember(messages: ChatMessage[]) {
    setArriving((current) => {
      const next = new Set(current);
      for (const message of messages) next.add(message.id);
      return next;
    });
  }

  /**
   * Point the panel at one borrow and answer with it.
   *
   * The list of borrows arrives as a block inside an answer, so "open" cannot
   * mean "navigate": the reader is already on the only page there is. It means
   * the same thing the rest of this surface means by an answer, which is a new
   * message carrying the panel for the position that was picked.
   */
  function openPosition(obligation: string, opening: ChatMessage) {
    select(obligation);

    const id = thread!.id;
    const history = thread!.messages.length === 0 ? [opening] : thread!.messages;
    const botMessage: ChatMessage = {
      id: newId(),
      role: "bot",
      at: Date.now(),
      blocks: [{ kind: "status" }],
      suggestions: available(context).slice(0, 4),
    };

    remember([botMessage]);
    setMessages(id, [...history, botMessage]);
  }

  async function send(input: string, opening: ChatMessage) {
    const trimmed = input.trim();
    const id = thread!.id;
    // Captured now: the thread can be switched while the model is answering, and the
    // reply belongs to the conversation it was asked in.
    const history = thread!.messages.length === 0 ? [opening] : thread!.messages;

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      at: Date.now(),
      blocks: [{ kind: "text", text: trimmed }],
      suggestions: [],
    };

    const withUser = [...history, userMessage];
    remember([userMessage]);
    setMessages(id, withUser);

    const appendBot = (blocks: ChatMessage["blocks"], suggestions: ChatMessage["suggestions"]) => {
      const botMessage: ChatMessage = { id: newId(), role: "bot", at: Date.now(), blocks, suggestions };
      remember([botMessage]);
      setMessages(id, [...withUser, botMessage]);
    };

    // Slash commands and recognised actions deliberately remain deterministic: they
    // render the same guarded screens and never let a language model imply a write.
    if (matchCommand(trimmed) !== null) {
      const answer = reply(trimmed, context);
      appendBot(answer.blocks, answer.suggestions);
      return;
    }

    setPendingIn(id);
    try {
      // The opening greeting is UI-only. Starting the API history with the user's
      // first turn keeps Anthropic's user/assistant alternation valid.
      const turns = withUser
        .filter((message) => message.id !== opening.id)
        .map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          content: apiContent(message),
        }))
        .filter((message) => message.content.length > 0)
        .filter((message) => !isBlockedRouterHtml(message.content))
        .map((message) => ({
          ...message,
          content: message.content.slice(-MAX_API_CONTENT_LENGTH),
        }))
        .slice(-12);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: turns,
          context: {
            connected: context.connected,
            world: context.world,
            clusterLabel: context.clusterLabel,
            positionCount: context.positionCount,
            supportedCount: context.supportedCount,
            hasGuard: context.hasGuard,
            paused: context.paused,
            ltvBps: context.ltvBps,
            triggerBps: context.triggerBps,
            liquidationBps: context.liquidationBps,
            refreshed: context.refreshed,
            canAct: context.canAct,
          },
        }),
      });
      const payload = (await response.json()) as {
        text?: string;
        action?: ProposedAction | RepayNowAction | null;
        error?: string;
      };
      if (!response.ok || (!payload.text && !payload.action)) {
        throw new Error(payload.error ?? "Chat request failed");
      }

      // A proposal is a block, not a sentence: the model suggests, the card shows
      // exactly what would be signed, and the wallet is the only thing that acts.
      const blocks: ChatMessage["blocks"] = [];
      if (payload.text) blocks.push({ kind: "text", text: payload.text });
      if (payload.action?.kind === "repay_now") {
        // An immediate repayment has no amount in the user's request. Open the
        // owner-signed screen so the current reserve, debt and LTV are read from
        // the selected source and the owner chooses the amount explicitly.
        blocks.push({ kind: "repayNow" });
      } else if (payload.action) {
        blocks.push({ kind: "proposal", action: payload.action });
      }

      appendBot(blocks, available(context).slice(0, 4));
    } catch (error) {
      // The local engine is a useful offline fallback, and makes a missing server key
      // explicit instead of leaving the composer silently spinning.
      const fallback = reply(trimmed, context);
      const reason = error instanceof Error ? error.message : "unknown server error";
      appendBot(
        [
          {
            kind: "text",
            text: `The language model is unavailable: ${reason} I am using the local command guide for now.`,
          },
          ...fallback.blocks,
        ],
        fallback.suggestions,
      );
    } finally {
      setPendingIn((current) => (current === id ? null : current));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row md:gap-8">
      <aside className="md:w-[220px] md:shrink-0 md:overflow-y-auto">
        <ThreadList
          threads={state.threads}
          activeId={state.activeId}
          now={now}
          onSelect={selectThread}
          onCreate={startThread}
          onDelete={remove}
        />
      </aside>

      {undo ? (
        // Fixed to the viewport, not to the composer. The composer grows and
        // shrinks with its suggestion chips, so anything anchored above it
        // lands inside it at some heights, which is where this first sat.
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex justify-center px-5"
        >
          <div className="pointer-events-auto flex items-center gap-4 rounded-panel border border-line bg-raised px-4 py-2.5 shadow-2xl">
            <span className="text-[13px] text-ink-dim">{en.app.chat.deleted}</span>
            <button
              type="button"
              onClick={() => {
                undo();
                setUndo(null);
              }}
              className="text-[13px] text-accent underline-offset-4 transition-colors duration-300 hover:underline"
            >
              {en.app.chat.undo}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Conversation
          key={thread.id}
          thread={thread}
          context={context}
          arriving={arriving}
          pending={pending}
          onSend={send}
          onOpenPosition={openPosition}
        />
      </div>
    </div>
  );
}
