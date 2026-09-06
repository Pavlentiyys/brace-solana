import type { ReactNode } from "react";

import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading, SectionLead } from "@/components/ui/section";
import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { money } from "@/lib/core/format";
import { simulate } from "@/lib/core/ltv/simulate";
import {
  DEMO_MARKET,
  DEMO_POSITION,
  DEMO_RESERVE,
  DEMO_RULE,
  getScenario,
} from "@/lib/scenarios";

/**
 * The section LANDING.md calls the most underrated one, and it is the only
 * place on the page where the product argues against itself.
 *
 * Every figure here is computed from the same simulation the reader can run
 * above, not written by hand. If the engine changes, these change with it, and
 * a claim that stops being true stops being printed.
 *
 * Three rows on hairlines. The loss leads, because it is the point; the reserve
 * drain and the wick follow with their own drawn evidence.
 */

function runScenario(id: string) {
  return simulate({
    position: DEMO_POSITION,
    reserve: DEMO_RESERVE,
    prices: getScenario(id).prices,
    rule: DEMO_RULE,
    market: DEMO_MARKET,
  });
}

/** Reserve after each action, as a falling bar strip. Real values. */
function ReserveDrain() {
  const result = runScenario("no-rebound");
  const steps = [DEMO_RESERVE];
  let left = DEMO_RESERVE;
  for (const action of result.withAgent.actions) {
    left -= action.spent + DEMO_MARKET.feePerAction;
    steps.push(Math.max(0, left));
  }

  return (
    <div className="flex h-11 w-32 shrink-0 items-end gap-1.5" aria-hidden="true">
      {steps.map((value, index) => (
        <div key={index} className="flex-1">
          <div
            className="w-full bg-accent"
            style={{ height: `${Math.max(2, (value / DEMO_RESERVE) * 48)}px`, opacity: value > 0 ? 1 : 0.25 }}
          />
        </div>
      ))}
    </div>
  );
}

/** The wick, drawn from the price series it refers to. */
function WickSpark() {
  const scenario = getScenario("wick");
  const prices = scenario.prices;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const w = 160;
  const h = 44;
  const d = prices
    .map((price, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((price - lo) / (hi - lo)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-11 w-40 shrink-0" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="var(--color-ink-dim)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One case per row: what goes wrong on the left, what it cost on the right.
 *
 * The loss in the no-rebound case gets `emphasis`, because it is the number the
 * section exists for and the only one on the page printed in the danger colour.
 */
function LimitRow({
  title,
  body,
  figure,
  label,
  visual,
  emphasis = false,
}: {
  title: string;
  body: string;
  figure: string;
  label: string;
  visual?: ReactNode;
  emphasis?: boolean;
}) {
  // Aligned to the top, not to a baseline. The figure is two to three times the
  // body's size, so a shared baseline drops the title well below its own number
  // and the row reads as broken.
  return (
    <article className="grid gap-4 border-t border-line py-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-10">
      <div>
        <h3 className="text-[15px] text-ink">{title}</h3>
        <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-ink-dim">{body}</p>
      </div>

      <div className="flex items-start gap-5 sm:justify-end">
        {visual}
        <div className="sm:text-right">
          <p
            className={cn(
              "num leading-none",
              emphasis ? "text-4xl text-state-danger md:text-5xl" : "text-2xl text-ink",
            )}
          >
            {figure}
          </p>
          <p className="mt-2 max-w-[26ch] text-[12px] leading-snug text-ink-faint sm:ml-auto">
            {label}
          </p>
        </div>
      </div>
    </article>
  );
}

export function Limits() {
  const noRebound = runScenario("no-rebound");
  const wick = runScenario("wick");

  const difference = noRebound.withAgent.finalEquity - noRebound.withoutAgent.finalEquity;
  const [reserveCase, noReboundCase, wickCase] = en.limits.cases;


  return (
    <Section id="limits">
      <Reveal>
        <SectionHeading>{en.limits.heading}</SectionHeading>
        <SectionLead>{en.limits.body}</SectionLead>
      </Reveal>

      {/*
        Three rows on hairlines, not three bordered cards.

        The cards were the third and fourth and fifth boxed panel on a page that
        already had two, and a row of identical containers reads as one shape
        repeated rather than three separate facts. Dividers and alignment carry
        the grouping; the figure on the right is what the eye lands on.
      */}
      <Reveal delay={0.05}>
        <div className="mt-10 flex flex-col">
          <LimitRow
            title={noReboundCase.title}
            body={noReboundCase.body}
            figure={money(difference)}
            label={noReboundCase.figureLabel}
            emphasis
          />

          <LimitRow
            title={reserveCase.title}
            body={reserveCase.body}
            figure={money(noRebound.withAgent.reserveLeft)}
            label={reserveCase.figureLabel}
            visual={<ReserveDrain />}
          />

          <LimitRow
            title={wickCase.title}
            body={wickCase.body}
            figure={money(wick.withAgent.actions[0]?.spent ?? 0)}
            label={wickCase.figureLabel}
            visual={<WickSpark />}
          />
        </div>
      </Reveal>
    </Section>
  );
}
