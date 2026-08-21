import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading, SectionLead } from "@/components/ui/section";
import { en } from "@/content/en";
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
 * Three cells, three sizes, three different visuals. Nothing here is a stock
 * card with an icon in the corner.
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
    <div className="mt-6 flex items-end gap-1.5" aria-hidden="true">
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

      <Reveal delay={0.05}>
        <div className="mt-10 grid gap-4 lg:grid-cols-5">
          {/* The reserve emptying, as the bars it actually produces. */}
          <article className="rounded-panel border border-line p-6 lg:col-span-2">
            <h3 className="text-[15px] text-ink">{reserveCase.title}</h3>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">{reserveCase.body}</p>
            <ReserveDrain />
            <p className="num mt-4 text-2xl text-ink">{money(noRebound.withAgent.reserveLeft)}</p>
            <p className="mt-1 text-[12px] leading-snug text-ink-faint">
              {reserveCase.figureLabel}
            </p>
          </article>

          {/* The number that matters most on the page. */}
          <article className="rounded-panel border border-line p-6 lg:col-span-3">
            <h3 className="text-[15px] text-ink">{noReboundCase.title}</h3>
            <p className="mt-3 max-w-[46ch] text-[13px] leading-relaxed text-ink-dim">
              {noReboundCase.body}
            </p>
            <p className="num mt-8 text-4xl leading-none text-state-danger md:text-5xl">
              {money(difference)}
            </p>
            <p className="mt-3 text-[12px] leading-snug text-ink-faint">
              {noReboundCase.figureLabel}
            </p>
          </article>

          {/* Full width and laid out sideways, so it does not read as a third
              copy of the two above. */}
          <article className="rounded-panel border border-line p-6 lg:col-span-5">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-[52ch]">
                <h3 className="text-[15px] text-ink">{wickCase.title}</h3>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">{wickCase.body}</p>
              </div>

              <div className="flex items-start gap-6">
                <WickSpark />
                <div>
                  <p className="num text-2xl leading-none text-ink">
                    {money(wick.withAgent.actions[0]?.spent ?? 0)}
                  </p>
                  <p className="mt-2 max-w-[26ch] text-[12px] leading-snug text-ink-faint">
                    {wickCase.figureLabel}
                  </p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </Reveal>
    </Section>
  );
}
