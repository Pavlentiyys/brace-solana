"use client";

import { useState } from "react";

import { percentFromBps } from "@/lib/format";
import type { SimulationResult } from "@/lib/ltv/simulate";
import { cn } from "@/lib/cn";
import { en } from "@/content/en";

/**
 * Two stacked panels on a shared x-axis: price on top for context, LTV below
 * where the argument actually happens.
 *
 * NOT a dual-axis chart. Price in dollars and LTV in percent on one pair of
 * y-scales would let the reader infer a relationship from where the two lines
 * cross, and where they cross is an artefact of the scales. Small multiples
 * say the same thing without the lie.
 *
 * Hand-rolled SVG rather than a chart library, for one reason: this component
 * has to render without JavaScript (LANDING.md section 5), and a responsive
 * container measures the DOM before it draws anything, so it ships an empty
 * box to a reader with scripts disabled. Everything here is computed during
 * render from props, so the server output is the finished chart. The hover
 * layer is the only thing that needs hydration, and its absence costs nothing.
 */

const W = 720;
const H = 384;
const PAD_L = 46;
const PAD_R = 96;
const PLOT_W = W - PAD_L - PAD_R;

const PRICE_TOP = 12;
const PRICE_H = 72;
const LTV_TOP = 122;
const LTV_H = 208;
const LTV_BOTTOM = LTV_TOP + LTV_H;
const AXIS_Y = 352;

function niceFloor(value: number, step: number) {
  return Math.floor(value / step) * step;
}
function niceCeil(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

export function SimulatorChart({
  result,
  liquidationLtvBps,
  triggerLtvBps,
  stepMinutes,
}: {
  result: SimulationResult;
  liquidationLtvBps: number;
  triggerLtvBps: number;
  stepMinutes: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const { prices, withAgent, withoutAgent } = result;
  const n = prices.length;

  const x = (i: number) => PAD_L + (i / (n - 1)) * PLOT_W;

  // Price scale.
  const priceLo = niceFloor(Math.min(...prices) * 0.97, 10);
  const priceHi = niceCeil(Math.max(...prices) * 1.02, 10);
  const yPrice = (p: number) =>
    PRICE_TOP + PRICE_H - ((p - priceLo) / (priceHi - priceLo)) * PRICE_H;

  // LTV scale, always wide enough to show the liquidation threshold.
  const allLtv = [...withAgent.ltvBps, ...withoutAgent.ltvBps].filter(
    (v): v is number => v !== null,
  );
  const ltvLo = niceFloor(Math.min(...allLtv, 6_000) - 300, 500);
  const ltvHi = niceCeil(Math.max(...allLtv, liquidationLtvBps) + 300, 500);
  const yLtv = (bps: number) =>
    LTV_TOP + LTV_H - ((bps - ltvLo) / (ltvHi - ltvLo)) * LTV_H;

  const linePath = (values: (number | null)[], scale: (v: number) => number) => {
    const segments: string[] = [];
    let open = false;
    values.forEach((value, i) => {
      if (value === null) {
        open = false;
        return;
      }
      segments.push(`${open ? "L" : "M"}${x(i).toFixed(2)} ${scale(value).toFixed(2)}`);
      open = true;
    });
    return segments.join(" ");
  };

  // Every ten points, not every five. Eleven gridlines across a 208px panel
  // reads as graph paper and competes with the two threshold lines that
  // actually carry meaning.
  const ltvTicks: number[] = [];
  for (let t = Math.ceil(ltvLo / 1_000) * 1_000; t <= ltvHi; t += 1_000) ltvTicks.push(t);

  const hoursPerStep = stepMinutes / 60;
  const xTickEvery = Math.max(1, Math.round(n / 6));
  const xTicks = Array.from({ length: n }, (_, i) => i).filter(
    (i) => i % xTickEvery === 0 || i === n - 1,
  );

  const hoveredWith = hover === null ? null : withAgent.ltvBps[hover];
  const hoveredWithout = hover === null ? null : withoutAgent.ltvBps[hover];

  function pointerIndex(event: React.PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    return Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${en.simulator.chart.price} and ${en.simulator.chart.axisLtv} over ${((n - 1) * hoursPerStep).toFixed(0)} hours. A table of the same values follows.`}
      >
        {/* Panel titles, so neither plot needs a legend to be identified. */}
        <text x={PAD_L} y={PRICE_TOP - 2} className="fill-ink-faint text-[10px]">
          {en.simulator.chart.axisPrice}
        </text>
        <text x={PAD_L} y={LTV_TOP - 12} className="fill-ink-faint text-[10px]">
          {en.simulator.chart.axisLtv}
        </text>

        {/* Price panel. Context only, so it stays recessive. */}
        <path
          d={linePath(prices, yPrice)}
          fill="none"
          stroke="var(--color-ink-faint)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text
          x={PAD_L + PLOT_W + 8}
          y={yPrice(prices[n - 1]) + 3}
          className="fill-ink-faint text-[10px]"
        >
          ${prices[n - 1].toFixed(2)}
        </text>

        {/* LTV gridlines. */}
        {ltvTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_L}
              x2={PAD_L + PLOT_W}
              y1={yLtv(tick)}
              y2={yLtv(tick)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 8}
              y={yLtv(tick) + 3}
              textAnchor="end"
              className="fill-ink-faint text-[10px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {(tick / 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/*
         * Threshold lines carry their own labels, so they are never identified
         * by colour alone. Only liquidation gets a status colour: two alarm
         * hues on one plot is noise, and the rule threshold is the user's own
         * setting rather than a warning.
         */}
        <line
          x1={PAD_L}
          x2={PAD_L + PLOT_W}
          y1={yLtv(triggerLtvBps)}
          y2={yLtv(triggerLtvBps)}
          stroke="var(--color-line-strong)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <text x={PAD_L + PLOT_W + 8} y={yLtv(triggerLtvBps) - 2} className="fill-ink-dim text-[10px]">
          {en.simulator.chart.trigger}
        </text>
        <text
          x={PAD_L + PLOT_W + 8}
          y={yLtv(triggerLtvBps) + 10}
          className="fill-ink-faint text-[10px]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {percentFromBps(triggerLtvBps)}
        </text>

        <line
          x1={PAD_L}
          x2={PAD_L + PLOT_W}
          y1={yLtv(liquidationLtvBps)}
          y2={yLtv(liquidationLtvBps)}
          stroke="var(--color-state-danger)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text
          x={PAD_L + PLOT_W + 8}
          y={yLtv(liquidationLtvBps) - 2}
          className="fill-state-danger text-[10px]"
        >
          {en.simulator.chart.liquidation}
        </text>
        <text
          x={PAD_L + PLOT_W + 8}
          y={yLtv(liquidationLtvBps) + 10}
          className="fill-ink-faint text-[10px]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {percentFromBps(liquidationLtvBps)}
        </text>

        {/* Baseline first, so the agent's line sits on top of it. */}
        <path
          d={linePath(withoutAgent.ltvBps, yLtv)}
          fill="none"
          stroke="var(--color-ink-dim)"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={linePath(withAgent.ltvBps, yLtv)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Where the agent acted. 8px across with a 2px surface ring. */}
        {withAgent.actions.map((action) => (
          <circle
            key={action.index}
            cx={x(action.index)}
            cy={yLtv(action.ltvBpsBefore)}
            r={4}
            fill="var(--color-accent)"
            stroke="var(--color-canvas)"
            strokeWidth={2}
          />
        ))}

        {/* Where each branch was liquidated. */}
        {(
          [
            [withoutAgent.liquidatedAt, "var(--color-ink-dim)"],
            [withAgent.liquidatedAt, "var(--color-state-danger)"],
          ] as const
        ).map(([index, colour], key) =>
          index === null ? null : (
            <g key={key}>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={LTV_TOP}
                y2={LTV_BOTTOM}
                stroke={colour}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <rect
                x={x(index) - 4}
                y={yLtv(liquidationLtvBps) - 4}
                width={8}
                height={8}
                fill={colour}
                stroke="var(--color-canvas)"
                strokeWidth={2}
              />
            </g>
          ),
        )}

        {/* X axis. */}
        <line
          x1={PAD_L}
          x2={PAD_L + PLOT_W}
          y1={LTV_BOTTOM}
          y2={LTV_BOTTOM}
          stroke="var(--color-line-strong)"
          strokeWidth={1}
        />
        {xTicks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={AXIS_Y - 20}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-ink-faint text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {(i * hoursPerStep).toFixed(hoursPerStep < 1 ? 1 : 0)}h
          </text>
        ))}
        <text x={PAD_L} y={AXIS_Y} className="fill-ink-faint text-[10px]">
          {en.simulator.chart.axisTime}
        </text>

        {/* Hover layer. Progressive enhancement: without it the chart is whole. */}
        {hover !== null ? (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PRICE_TOP}
              y2={LTV_BOTTOM}
              stroke="var(--color-line-strong)"
              strokeWidth={1}
            />
            <circle cx={x(hover)} cy={yPrice(prices[hover])} r={3} fill="var(--color-ink-dim)" />
            {hoveredWith !== null && hoveredWith !== undefined ? (
              <circle
                cx={x(hover)}
                cy={yLtv(hoveredWith)}
                r={4}
                fill="var(--color-accent)"
                stroke="var(--color-canvas)"
                strokeWidth={2}
              />
            ) : null}
            {hoveredWithout !== null && hoveredWithout !== undefined ? (
              <circle
                cx={x(hover)}
                cy={yLtv(hoveredWithout)}
                r={4}
                fill="var(--color-ink-dim)"
                stroke="var(--color-canvas)"
                strokeWidth={2}
              />
            ) : null}
            <g
              transform={`translate(${Math.min(x(hover) + 10, PAD_L + PLOT_W - 118)}, ${LTV_TOP + 6})`}
            >
              <rect
                width={118}
                height={58}
                rx={6}
                fill="var(--color-raised)"
                stroke="var(--color-line-strong)"
              />
              <text
                x={10}
                y={18}
                className="fill-ink-dim text-[10px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {(hover * hoursPerStep).toFixed(1)}h · ${prices[hover].toFixed(2)}
              </text>
              <text
                x={10}
                y={34}
                className="fill-accent text-[11px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {hoveredWith === null || hoveredWith === undefined
                  ? "liquidated"
                  : percentFromBps(hoveredWith)}
              </text>
              <text
                x={10}
                y={50}
                className="fill-ink-dim text-[11px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {hoveredWithout === null || hoveredWithout === undefined
                  ? "liquidated"
                  : percentFromBps(hoveredWithout)}
              </text>
            </g>
          </g>
        ) : null}

        <rect
          x={PAD_L}
          y={PRICE_TOP}
          width={PLOT_W}
          height={LTV_BOTTOM - PRICE_TOP}
          fill="transparent"
          onPointerMove={(event) => {
            const next = pointerIndex(event);
            // Only re-render when the bucket actually changes, not on every
            // pointer event.
            setHover((current) => (current === next ? current : next));
          }}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      <Legend />
    </div>
  );
}

function Legend() {
  const items = [
    { label: en.simulator.chart.ltvWithAgent, colour: "var(--color-accent)", dash: undefined },
    { label: en.simulator.chart.ltvWithoutAgent, colour: "var(--color-ink-dim)", dash: "5 4" },
    { label: en.simulator.chart.price, colour: "var(--color-ink-faint)", dash: undefined },
  ];

  return (
    <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-ink-dim">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          {/* Dash pattern repeats in the swatch, so the two LTV lines differ
              by more than hue for anyone who cannot separate them. */}
          <svg width={18} height={8} aria-hidden="true" className="shrink-0">
            <line
              x1={0}
              x2={18}
              y1={4}
              y2={4}
              stroke={item.colour}
              strokeWidth={2}
              strokeDasharray={item.dash}
            />
          </svg>
          <span className={cn(item.label === en.simulator.chart.price && "text-ink-faint")}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
