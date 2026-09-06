"use client";

import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { sortThreads, type Thread } from "@/lib/chat/threads";

/**
 * The conversations, and the controls for them.
 *
 * A rail on desktop and a horizontal strip on small screens. The delete is always
 * visible rather than hidden behind a hover or a menu: these threads are stored in
 * the browser and quote real figures, so removing one has to be as easy as starting
 * one.
 */

function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ThreadList({
  threads,
  activeId,
  now,
  onSelect,
  onCreate,
  onDelete,
}: {
  threads: Thread[];
  activeId: string | null;
  /** Passed in rather than read here, so every row agrees and nothing re-renders on a timer. */
  now: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const ordered = sortThreads(threads);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onCreate}
        className="min-h-10 shrink-0 rounded-panel border border-line-strong px-3 text-left text-[13px] text-ink transition-colors duration-300 hover:border-accent"
      >
        {en.app.chat.newChat}
      </button>

      <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {ordered.map((thread) => {
          const active = thread.id === activeId;

          return (
            <li key={thread.id} className="shrink-0 md:shrink">
              <div
                className={cn(
                  "group flex min-h-10 w-[200px] items-center gap-2 rounded-panel border px-3 transition-colors duration-300 md:w-full",
                  active
                    ? "border-accent/40 bg-accent-wash"
                    : "border-line hover:border-line-strong",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(thread.id)}
                  aria-current={active ? "true" : undefined}
                  className="min-w-0 flex-1 py-2 text-left"
                >
                  <span className="block truncate text-[12px] text-ink">{thread.title}</span>
                  <span className="mt-0.5 block text-[10px] text-ink-faint">
                    {relativeTime(thread.updatedAt, now)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(thread.id)}
                  aria-label={`${en.app.chat.deleteChat}: ${thread.title}`}
                  title={en.app.chat.deleteChat}
                  // Revealed on hover and on keyboard focus, not always on. A
                  // permanent glyph next to every title invites the accidental
                  // click it is hardest to recover from, and the keyboard path
                  // has to stay open regardless of the pointer.
                  className="shrink-0 rounded px-1 text-[14px] leading-none text-ink-faint opacity-0 transition-all duration-300 hover:text-state-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
