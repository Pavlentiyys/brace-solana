import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { en } from "@/content/en";

export const metadata: Metadata = {
  title: "Getting started",
  description: "Connect an address, set a rule in the chat and fund the reserve.",
};

export default function GettingStartedPage() {
  return (
    <article className="max-w-[760px]">
      <h1 className="text-3xl leading-tight tracking-tight text-ink md:text-4xl">
        {en.start.heading}
      </h1>

      <ol className="mt-12 flex flex-col">
        {en.start.steps.map((step, index) => (
          <li key={step.title} className="border-t border-line py-8 md:py-10">
            <div className="grid gap-4 md:grid-cols-[3rem_minmax(0,1fr)_10rem] md:items-baseline md:gap-8">
              <span className="num text-[13px] text-ink-faint">
                {String(index + 1).padStart(2, "0")}
              </span>

              <div>
                <h2 className="text-[17px] leading-snug text-ink">{step.title}</h2>
                <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ink-dim">
                  {step.body}
                </p>
              </div>

              <div className="flex flex-col gap-1.5 md:text-right">
                <span className="text-[11px] text-ink-faint">You need</span>
                <span className="text-[13px] text-ink">{step.requires}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap items-center gap-5 border-t border-line pt-8">
        <ButtonLink href="/app">{en.start.cta}</ButtonLink>
        <p className="max-w-[52ch] text-[12px] leading-relaxed text-ink-faint">
          {en.start.ctaNote}
        </p>
      </div>
    </article>
  );
}
