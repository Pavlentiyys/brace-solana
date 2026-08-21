import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/section";
import { en } from "@/content/en";
import { money, percentFromBps, tokens } from "@/lib/format";
import { liquidationPrice, ltvBps } from "@/lib/ltv/calc";
import { DEMO_POSITION, DEMO_RULE, SCENARIOS } from "@/lib/scenarios";

/**
 * Asymmetric split, not a centred hero.
 *
 * Four text elements and no more: headline, subtext, one button, and the
 * readout panel beside them. No eyebrow, no version pill, no trust strip, no
 * scroll cue. The subtext is doing the most important job on the page, which
 * is answering "what can this thing do with my money" before anybody scrolls
 * (LANDING.md section 1).
 *
 * The readout is not a mock. Its numbers come out of the same functions the
 * simulator runs, so it cannot drift away from the rest of the page.
 */
export function Hero() {
  const startPrice = SCENARIOS[0].prices[0];
  const startLtv = ltvBps(DEMO_POSITION, startPrice);
  const liqPrice = liquidationPrice(DEMO_POSITION);

  const rows = [
    { label: en.hero.readout.collateral, value: tokens(DEMO_POSITION.collateral) },
    { label: en.hero.readout.debt, value: money(DEMO_POSITION.debt) },
    { label: en.hero.readout.ltv, value: percentFromBps(startLtv) },
    { label: en.hero.readout.trigger, value: percentFromBps(DEMO_RULE.steps[0].triggerLtvBps) },
    { label: en.hero.readout.liquidation, value: money(liqPrice) },
  ];

  return (
    // No forced full-viewport height. Filling one meant centring a short block
    // inside it, which floats the headline halfway down the screen and reads as
    // a layout bug. Bounded padding puts the hero where a hero goes and lets
    // the simulator show its top edge, which invites a scroll better than a
    // scroll cue would.
    <section className="py-20 md:py-28">
      <Container>
        {/*
          The split waits for xl, not lg. At 1024 a two-column hero leaves the
          headline about 530px to work with, and 40px type in 530px runs to
          three lines. Below 1280 the headline gets the full measure instead.
        */}
        <div className="grid items-center gap-12 xl:grid-cols-[1.1fr_0.9fr] xl:gap-16">
          <div>
            <h1 className="max-w-[32ch] text-[1.75rem] leading-[1.15] tracking-tight text-ink sm:text-[2.125rem] xl:text-[2.5rem]">
              {en.hero.headline}
            </h1>

            <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-ink-dim md:text-base">
              {en.hero.subheadline}
            </p>

            <div className="mt-9">
              <ButtonLink href="#simulator">{en.hero.cta}</ButtonLink>
            </div>
          </div>

          <div className="rounded-panel border border-line bg-surface">
            <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3.5">
              <span className="text-[12px] text-ink-dim">{en.hero.readout.title}</span>
              <span className="num text-[12px] text-ink-faint">SOL {money(startPrice)}</span>
            </div>

            <dl>
              {rows.map((row, index) => (
                <div
                  key={row.label}
                  className={cnRow(index === rows.length - 1)}
                >
                  <dt className="text-[13px] text-ink-dim">{row.label}</dt>
                  <dd className="num text-[13px] text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Container>
    </section>
  );
}

function cnRow(last: boolean) {
  return `flex items-baseline justify-between gap-4 px-5 py-3 ${last ? "" : "border-b border-line"}`;
}
