import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import type { ChatMessage } from "./engine";
import {
  MAX_MESSAGES_PER_THREAD,
  UNTITLED,
  clearThreads,
  createThread,
  loadThreads,
  saveThreads,
  sortThreads,
  titleFrom,
  touch,
} from "./threads";

/**
 * The store, which is where a mistake quietly loses somebody's conversation.
 *
 * `localStorage` is stubbed rather than mocked away, including the case where it
 * throws — some privacy modes do that on every access, and a chat list is not worth
 * a blank screen.
 */

function stubStorage(overrides: Partial<Storage> = {}) {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    ...overrides,
  } as Storage;

  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return map;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function said(text: string): ChatMessage {
  return { id: text, role: "user", at: 0, blocks: [{ kind: "text", text }], suggestions: [] };
}

function bot(text: string): ChatMessage {
  return { id: `b${text}`, role: "bot", at: 0, blocks: [{ kind: "text", text }], suggestions: [] };
}

test("a new thread is untitled until the user says something", () => {
  const thread = createThread();
  assert.equal(thread.title, UNTITLED);
  assert.equal(thread.messages.length, 0);
  assert.notEqual(thread.id, createThread().id);
});

test("the title comes from the first user message, never from the bot", () => {
  // Every thread opens with the same greeting, so titling from it would give a list
  // of rows all reading the same sentence.
  assert.equal(titleFrom([bot("I watch a Kamino borrow")]), UNTITLED);
  assert.equal(titleFrom([bot("greeting"), said("how is my position")]), "how is my position");
});

test("a slash command titles as its plain name", () => {
  assert.equal(titleFrom([said("/status")]), "status");
});

test("a long question is truncated rather than allowed to break the row", () => {
  const title = titleFrom([said("a".repeat(120))]);
  assert.ok(title.length <= 42, `title was ${title.length} characters`);
  assert.ok(title.endsWith("…"));
});

test("a title set once is not rewritten by later messages", () => {
  const thread = touch(createThread(), [said("first question")]);
  const later = touch(thread, [said("first question"), said("second question")]);
  assert.equal(later.title, "first question");
});

test("a thread keeps only its most recent messages", () => {
  const many = Array.from({ length: MAX_MESSAGES_PER_THREAD + 20 }, (_, index) =>
    said(`m${index}`),
  );
  const thread = touch(createThread(), many);

  assert.equal(thread.messages.length, MAX_MESSAGES_PER_THREAD);
  // The tail is kept, not the head: a conversation is read from the bottom.
  assert.equal(thread.messages.at(-1)?.id, `m${many.length - 1}`);
});

test("threads are listed most recently used first", () => {
  const older = { ...createThread(), updatedAt: 1_000 };
  const newer = { ...createThread(), updatedAt: 2_000 };
  assert.deepEqual(
    sortThreads([older, newer]).map((thread) => thread.updatedAt),
    [2_000, 1_000],
  );
});

test("threads survive a round trip through storage", () => {
  stubStorage();
  const thread = touch(createThread(), [said("how is my position")]);
  saveThreads([thread], thread.id);

  const loaded = loadThreads();
  assert.equal(loaded?.activeId, thread.id);
  assert.equal(loaded?.threads[0].title, "how is my position");
  assert.equal(loaded?.threads[0].messages.length, 1);
});

test("an active id pointing at a deleted thread falls back rather than blanking", () => {
  stubStorage();
  const kept = touch(createThread(), [said("kept")]);
  saveThreads([kept], "an-id-that-no-longer-exists");

  const loaded = loadThreads();
  assert.equal(loaded?.activeId, kept.id);
});

test("unparseable storage is discarded, not partly trusted", () => {
  const map = stubStorage();
  map.set("brace.chat.threads.v1", "{not json");
  assert.equal(loadThreads(), null);

  map.set("brace.chat.threads.v1", JSON.stringify({ threads: "nonsense" }));
  assert.equal(loadThreads(), null);
});

test("entries that are not threads are dropped", () => {
  const map = stubStorage();
  const good = touch(createThread(), [said("good")]);
  map.set(
    "brace.chat.threads.v1",
    JSON.stringify({ threads: [good, { id: 5 }, { messages: null }], activeId: good.id }),
  );

  const loaded = loadThreads();
  assert.equal(loaded?.threads.length, 1);
  assert.equal(loaded?.threads[0].id, good.id);
});

test("storage that throws is survivable in both directions", () => {
  // Safari in private mode, and any browser with site data blocked.
  const boom = () => {
    throw new Error("storage disabled");
  };
  stubStorage({ getItem: boom, setItem: boom, removeItem: boom });

  assert.equal(loadThreads(), null);
  assert.doesNotThrow(() => saveThreads([createThread()], null));
  assert.doesNotThrow(() => clearThreads());
});

test("nothing touches storage during a server render", () => {
  // `window` is absent here, which is the state while prerendering.
  assert.equal(loadThreads(), null);
  assert.doesNotThrow(() => saveThreads([createThread()], null));
});
