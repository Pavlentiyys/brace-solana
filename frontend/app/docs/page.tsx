import type { Metadata } from "next";
import Link from "next/link";

import { en } from "@/content/en";

export const metadata: Metadata = {
  title: en.docs.title,
  description: en.docs.intro,
};

/**
 * Sections that are not written yet are listed as not written, rather than
 * hidden or linked to an empty page. A docs index that lies about its own
 * coverage is a bad first impression for a reference.
 */
export default function DocsIndex() {
  return (
    <div>
      <h1 className="text-3xl leading-tight tracking-tight text-ink md:text-4xl">
        {en.docs.title}
      </h1>
      <p className="mt-5 max-w-[62ch] text-[15px] leading-relaxed text-ink-dim">
        {en.docs.intro}
      </p>

      <ul className="mt-12 flex flex-col">
        {en.docs.index.map((entry) => (
          <li key={entry.title} className="border-t border-line">
            {entry.ready && "href" in entry && entry.href ? (
              <Link
                href={entry.href}
                className="group flex flex-col gap-1.5 py-5 transition-opacity duration-300 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8"
              >
                <span className="flex flex-col gap-1.5">
                  <span className="text-[15px] text-ink transition-colors duration-300 group-hover:text-accent">
                    {entry.title}
                  </span>
                  <span className="max-w-[58ch] text-[13px] leading-relaxed text-ink-dim">
                    {entry.summary}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-ink-faint">{en.docs.written}</span>
              </Link>
            ) : (
              <div className="flex flex-col gap-1.5 py-5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
                <span className="flex flex-col gap-1.5">
                  <span className="text-[15px] text-ink-dim">{entry.title}</span>
                  <span className="max-w-[58ch] text-[13px] leading-relaxed text-ink-faint">
                    {entry.summary}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-ink-faint">{en.docs.pending}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
