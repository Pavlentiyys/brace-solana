"use client";

import { StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { percentFromBps } from "@/lib/core/format";
import { bpsUntil, dropToLtv, priceAtLtv } from "@/lib/core/guard";
import { money } from "@/lib/core/format";

/**
 * The top of the panel: one number, and how far it is from the two thresholds that
 * matter.
 *
 * PLATFORM.md 2.5 asks for this to be readable in half a second on a phone, which
 * decides the whole layout. The LTV is the only thing set at display size; the two
 * distances sit under it at body size; the scale is a single bar rather than a
 * chart, because a chart asks to be studied and this asks to be glanced at.
 *
 * The distances are stated twice on purpose, in basis points and as a price. "8.4
 * points to your rule" is the number the rule is written in, and "your rule fires at
 * $138.20" is the number the reader can compare against a ticker.
 */

function tone(ltvBps: number, triggerBps: number, liquidationBps: number) {
  if (ltvBps >= liquidationBps) return "danger" as const;
  if (ltvBps >= triggerBps) return "warn" as const;
  return "ok" as const;
}

export function LtvReadout({
  ltvBps,
  triggerLtvBps,
  liquidationLtvBps,
  price,
}: {
  ltvBps: number;
  triggerLtvBps: number;
  liquidationLtvBps: number;
  price: number;
}) {
  const copy = en.app.panel;
  const state = tone(ltvBps, triggerLtvBps, liquidationLtvBps);

  const toTrigger = bpsUntil(ltvBps, triggerLtvBps);
  const toLiquidation = bpsUntil(ltvBps, liquidationLtvBps);

  // The bar runs to a tenth past liquidation, so a position at the threshold sits
  // near the end rather than exactly on it and the marker stays visible.
  const scaleMax = liquidationLtvBps * 1.1;
  const position = (value: number) => `${Math.min(100, Math.max(0, (value / scaleMax) * 100))}%`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">{copy.ltvLabel}</p>
          <p
            className={cn(
              "num mt-2 text-5xl leading-none tracking-tight md:text-6xl",
              state === "danger" ? "text-state-danger" : "text-ink",
            )}
          >
            {percentFromBps(ltvBps)}
          </p>
        </div>

        <dl className="flex gap-6 text-[13px]">
          <div>
            <dt className="text-ink-faint">
              {toTrigger >= 0 ? copy.toTrigger : copy.pastTrigger}
            </dt>
            <dd className="num mt-1 text-ink">
              {percentFromBps(Math.abs(toTrigger))}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">
              {toLiquidation >= 0 ? copy.toLiquidation : copy.pastLiquidation}
            </dt>
            <dd className="num mt-1 text-ink">{percentFromBps(Math.abs(toLiquidation))}</dd>
          </div>
        </dl>
      </div>

      {/* The scale. Both thresholds are labelled, so neither is identified by
          colour alone. */}
      <div className="mt-6">
        <div className="relative h-2 rounded-panel bg-raised">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-panel",
              state === "danger" ? "bg-state-danger" : "bg-accent",
            )}
            style={{ width: position(ltvBps) }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-y-[-3px] w-px bg-line-strong"
            style={{ left: position(triggerLtvBps) }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-y-[-3px] w-px bg-state-danger"
            style={{ left: position(liquidationLtvBps) }}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
          <span className="flex items-center gap-2 text-ink-dim">
            <StatusDot tone="neutral" />
            {copy.triggerAt} <span className="num text-ink">{percentFromBps(triggerLtvBps)}</span>
            <span className="num text-ink-faint">
              {money(priceAtLtv(price, ltvBps, triggerLtvBps))}
            </span>
          </span>
          <span className="flex items-center gap-2 text-ink-dim">
            <StatusDot tone="danger" />
            {copy.liquidationAt}{" "}
            <span className="num text-ink">{percentFromBps(liquidationLtvBps)}</span>
            <span className="num text-ink-faint">
              {money(priceAtLtv(price, ltvBps, liquidationLtvBps))}
            </span>
          </span>
          <span className="flex items-center gap-2 text-ink-dim">
            {copy.priceNow} <span className="num text-ink">{money(price)}</span>
            <span className="num text-ink-faint">
              {(dropToLtv(ltvBps, liquidationLtvBps) * 100).toFixed(1)}% to liquidation
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
