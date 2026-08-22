/**
 * The thread list as an external store.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect, because the threads
 * live in `localStorage` — outside React — and reading them during render would
 * produce one answer on the server (nothing) and another on the client (the stored
 * list), which is a hydration mismatch. This is the API built for exactly that: the
 * server snapshot is empty, the client snapshot is real, and React reconciles the
 * difference itself instead of warning about it.
 */

import {
  createThread,
  loadThreads,
  saveThreads,
  sortThreads,
  touch,
  MAX_THREADS,
  UNTITLED,
  type Thread,
} from "@/lib/chat/threads";
import type { ChatMessage } from "@/lib/chat/engine";

export interface ThreadState {
  threads: Thread[];
  activeId: string | null;
}

/**
 * One frozen object for every server render.
 *
 * `useSyncExternalStore` compares snapshots by identity, so returning a fresh
 * `{ threads: [] }` each call would loop forever.
 *
 * It carries a placeholder thread rather than an empty list. An empty one renders
 * nothing, which would leave the prerendered page blank until hydration and drop the
 * greeting and composer out of the HTML entirely. The id is fixed so the server and
 * the first client render agree on it.
 */
const SERVER_THREAD: Thread = Object.freeze({
  id: "server",
  title: UNTITLED,
  createdAt: 0,
  updatedAt: 0,
  messages: [],
});

const SERVER_STATE: ThreadState = Object.freeze({
  threads: [SERVER_THREAD],
  activeId: SERVER_THREAD.id,
});

let state: ThreadState | null = null;
const listeners = new Set<() => void>();

function fresh(): ThreadState {
  const thread = createThread();
  return { threads: [thread], activeId: thread.id };
}

/** Read once on the client, then kept in memory. */
function ensure(): ThreadState {
  if (state === null) state = loadThreads() ?? fresh();
  return state;
}

function commit(next: ThreadState): void {
  state = next;
  saveThreads(next.threads, next.activeId);
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ThreadState {
  return ensure();
}

export function getServerSnapshot(): ThreadState {
  return SERVER_STATE;
}

export function activeThread(current: ThreadState): Thread | null {
  return current.threads.find((thread) => thread.id === current.activeId) ?? null;
}

export function selectThread(id: string): void {
  const current = ensure();
  if (current.activeId === id) return;
  commit({ ...current, activeId: id });
}

/**
 * Starts a new conversation, or reuses the empty one that is already open.
 *
 * Clicking "new chat" twice should not leave two identical blank rows behind.
 */
export function startThread(): void {
  const current = ensure();
  const open = activeThread(current);
  if (open && open.messages.length === 0) return;

  const thread = createThread();
  const threads = sortThreads([thread, ...current.threads]).slice(0, MAX_THREADS);
  commit({ threads, activeId: thread.id });
}

/** Removes a thread, keeping at least one so the composer always has a home. */
export function deleteThread(id: string): void {
  const current = ensure();
  const remaining = current.threads.filter((thread) => thread.id !== id);

  if (remaining.length === 0) {
    commit(fresh());
    return;
  }

  const activeId =
    current.activeId === id ? sortThreads(remaining)[0].id : current.activeId;
  commit({ threads: remaining, activeId });
}

export function setMessages(id: string, messages: ChatMessage[]): void {
  const current = ensure();
  const threads = current.threads.map((thread) =>
    thread.id === id ? touch(thread, messages) : thread,
  );
  commit({ ...current, threads });
}

/** Test seam: drops the in-memory copy so the next read comes from storage again. */
export function resetStoreForTests(): void {
  state = null;
  listeners.clear();
}
