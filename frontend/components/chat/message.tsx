"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Mark } from "@/components/site/mark";
import { cn } from "@/lib/cn";
import type { ChatBlock, ChatMessage } from "@/lib/chat/engine";

/**
 * How a message looks, and how a new one arrives.
 *
 * Two jobs, and the second is the one with a trap in it. Typing text out is a
 * legible way to say "this answer is arriving", but a readout of somebody's
 * liquidation risk that animates every time React re-renders would be unreadable —
 * and this panel re-renders on every poll. So the reveal is keyed to the message id
 * and runs exactly once, and `prefers-reduced-motion` skips it entirely rather than
 * shortening it.
 *
 * Author is carried by three signals, not one: side, frame colour and a label. Side
 * alone fails at narrow widths and means nothing to a screen reader.
 */

/** At least this fast, and never longer than the cap however long the text is. */
const CHARACTERS_PER_SECOND = 55;
const MAX_REVEAL_MS = 1_600;
/** A rich block is not typed; it fades in and hands over after this long. */
const BLOCK_HANDOVER_MS = 140;

function Typewriter({
  text,
  animate,
  index,
  onDone,
}: {
  text: string;
  animate: boolean;
  index: number;
  onDone: (index: number) => void;
}) {
  const reduce = useReducedMotion();
  const typing = animate && !reduce;

  // Seeded at the right value so nothing has to be corrected in an effect, which
  // would flash the full text for one frame before collapsing it.
  const [shown, setShown] = useState(() => (typing ? 0 : text.length));

  useEffect(() => {
    if (!typing) {
      onDone(index);
      return;
    }

    const duration = Math.min(MAX_REVEAL_MS, (text.length / CHARACTERS_PER_SECOND) * 1000);
    const startedAt = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      setShown(Math.ceil(progress * text.length));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        onDone(index);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, typing, index, onDone]);

  const complete = shown >= text.length;

  return (
    <p className="text-[13px] leading-relaxed text-ink">
      {/*
        The full string stays in the DOM and is only visually clipped, so a screen
        reader announces the answer once and in full instead of narrating it letter
        by letter.
      */}
      <span aria-hidden={!complete}>{text.slice(0, shown)}</span>
      {complete ? null : (
        <>
          <span className="sr-only">{text}</span>
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.15em] animate-pulse bg-accent"
          />
        </>
      )}
    </p>
  );
}

function Fade({ children, animate }: { children: ReactNode; animate: boolean }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={animate && !reduce ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Reveals the blocks in order: text types, anything richer fades in.
 *
 * Order is preserved rather than "all text then all panels", because a failure
 * notice that appears above its own explanation reads as a different message.
 */
function Body({
  message,
  animate,
  renderBlock,
}: {
  message: ChatMessage;
  animate: boolean;
  renderBlock: (block: ChatBlock) => ReactNode;
}) {
  const [revealed, setRevealed] = useState(animate ? 0 : message.blocks.length);
  const visible = animate ? Math.min(revealed + 1, message.blocks.length) : message.blocks.length;

  // Stable for the life of the message, so the children can list it in their effect
  // dependencies without restarting the reveal on every parent render.
  const advance = useCallback((index: number) => {
    setRevealed((current) => Math.max(current, index + 1));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {message.blocks.slice(0, visible).map((block, index) => {
        const isCurrent = index === revealed;

        if (block.kind === "text") {
          return (
            <Typewriter
              key={index}
              text={block.text}
              animate={animate && isCurrent}
              index={index}
              onDone={advance}
            />
          );
        }

        return (
          <RichBlock
            key={index}
            animate={animate && isCurrent}
            active={isCurrent}
            index={index}
            onDone={advance}
          >
            {renderBlock(block)}
          </RichBlock>
        );
      })}
    </div>
  );
}

function RichBlock({
  children,
  animate,
  active,
  index,
  onDone,
}: {
  children: ReactNode;
  animate: boolean;
  active: boolean;
  index: number;
  onDone: (index: number) => void;
}) {
  useEffect(() => {
    if (!active) return;
    // A timeout rather than an immediate call, so the fade has a moment before the
    // next block starts and the message does not land all at once.
    const timer = window.setTimeout(() => onDone(index), animate ? BLOCK_HANDOVER_MS : 0);
    return () => window.clearTimeout(timer);
  }, [active, animate, index, onDone]);

  return <Fade animate={animate}>{children}</Fade>;
}

function Author({ mine }: { mine: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      {mine ? null : <Mark className="h-3.5 w-3.5 text-ink-dim" />}
      <span className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {mine ? "You" : "Brace"}
      </span>
    </div>
  );
}

export function Bubble({
  message,
  animate,
  renderBlock,
}: {
  message: ChatMessage;
  animate: boolean;
  renderBlock: (block: ChatBlock) => ReactNode;
}) {
  const mine = message.role === "user";
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={cn("flex", mine ? "justify-end" : "justify-start")}
      initial={animate && !reduce ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className={cn(
          "rounded-panel border px-4 py-3",
          mine
            // The accent wash is the one place a user's own words are tinted, so it
            // reads as theirs without a second colour entering the palette.
            ? "max-w-[85%] rounded-br-none border-accent/35 bg-accent-wash"
            // Full width: the bot answers with panels, and a bubble that hugged its
            // content would leave a table scrolling inside a narrow box.
            : "w-full rounded-bl-none border-line bg-surface",
        )}
      >
        <Author mine={mine} />
        {/*
          The container fades in either way, but only the bot types. Replaying a
          sentence back at the person who just typed it is theatre, not feedback.
        */}
        <Body message={message} animate={animate && !mine} renderBlock={renderBlock} />
      </div>
    </motion.div>
  );
}

/** Shown while a reply is in flight, so the wait is legible rather than silent. */
export function Thinking() {
  const reduce = useReducedMotion();

  return (
    <div className="flex justify-start">
      <div className="rounded-panel rounded-bl-none border border-line bg-surface px-4 py-3">
        <Author mine={false} />
        <div className="flex items-center gap-1.5" role="status" aria-label="Thinking">
          {[0, 1, 2].map((index) => (
            <motion.span
              key={index}
              className="h-1.5 w-1.5 rounded-full bg-ink-faint"
              animate={reduce ? undefined : { opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.18 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
