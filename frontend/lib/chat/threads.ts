/**
 * Several conversations, and where they live.
 *
 * The single thread used to be deliberately throwaway: it lived in the tab and
 * started over on reload, so the app never held a log of somebody's positions they
 * had not asked it to keep. A list of chats that empties itself on reload is not a
 * list of chats, though, so keeping them is now the point rather than a side effect.
 *
 * What that costs is stated rather than hidden. A stored thread contains the
 * questions asked and the sentences answered, and those sentences quote real figures
 * — "LTV is 60.90%" is in there. It stays in this browser, is never sent anywhere,
 * and every thread has a delete next to it. Rich blocks are stored as their kind
 * alone, so a panel re-reads the cluster when it is shown again instead of
 * displaying a snapshot of what was true last week.
 */

import type { ChatMessage } from "@/lib/chat/engine";

export interface Thread {
  id: string;
  /** Derived from the first thing the user said, or the fallback until they speak. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const STORAGE_KEY = "brace.chat.threads.v1";

/** Enough to be useful, bounded so the store cannot grow without limit. */
export const MAX_THREADS = 20;
export const MAX_MESSAGES_PER_THREAD = 200;

export const UNTITLED = "New chat";

export function newId(): string {
  // `randomUUID` needs a secure context, which localhost and https both are; the
  // fallback keeps a plain-http preview from throwing.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createThread(): Thread {
  const now = Date.now();
  return { id: newId(), title: UNTITLED, createdAt: now, updatedAt: now, messages: [] };
}

/**
 * A title from the first thing the user said.
 *
 * The bot's opening is identical in every thread, so titling from it would give a
 * list of twenty rows reading the same sentence.
 */
export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return UNTITLED;

  const text = first.blocks
    .filter((block): block is Extract<typeof block, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text === "") return UNTITLED;
  // Slash commands read better as their plain name.
  const cleaned = text.startsWith("/") ? text.slice(1) : text;
  return cleaned.length > 42 ? `${cleaned.slice(0, 41).trimEnd()}…` : cleaned;
}

export function touch(thread: Thread, messages: ChatMessage[]): Thread {
  const trimmed =
    messages.length > MAX_MESSAGES_PER_THREAD
      ? messages.slice(messages.length - MAX_MESSAGES_PER_THREAD)
      : messages;

  return {
    ...thread,
    messages: trimmed,
    title: thread.title === UNTITLED ? titleFrom(trimmed) : thread.title,
    updatedAt: Date.now(),
  };
}

/** Most recently used first, which is the order a chat list is read in. */
export function sortThreads(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

interface Stored {
  threads: Thread[];
  activeId: string | null;
}

/**
 * Reads the stored threads, or nothing at all.
 *
 * Every access is guarded: storage throws outright in some privacy modes, and a
 * chat list is not worth a blank screen. Anything unparseable is discarded rather
 * than partially trusted.
 */
export function loadThreads(): Stored | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as Stored;
    if (!Array.isArray(parsed.threads)) return null;

    const threads = parsed.threads.filter(
      (thread): thread is Thread =>
        typeof thread?.id === "string" && Array.isArray(thread.messages),
    );
    if (threads.length === 0) return null;

    const activeId =
      typeof parsed.activeId === "string" &&
      threads.some((thread) => thread.id === parsed.activeId)
        ? parsed.activeId
        : threads[0].id;

    return { threads, activeId };
  } catch {
    return null;
  }
}

export function saveThreads(threads: Thread[], activeId: string | null): void {
  if (typeof window === "undefined") return;

  try {
    const payload: Stored = { threads: sortThreads(threads).slice(0, MAX_THREADS), activeId };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota, or storage disabled. The conversation still works for this session, and
    // failing to persist is not worth interrupting somebody mid-question.
  }
}

export function clearThreads(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning.
  }
}
