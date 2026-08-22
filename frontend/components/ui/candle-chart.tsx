"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { money } from "@/lib/core/format";

type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};

const UP = "var(--color-state-ok)";
const DOWN = "var(--color-state-danger)";
const WIDTH = 720;
const HEIGHT = 360;
const AXIS_WIDTH = 58;
const VOLUME_HEIGHT = 44;
const GAP = 10;
const PLOT_WIDTH = WIDTH - AXIS_WIDTH;
const PLOT_HEIGHT = HEIGHT - VOLUME_HEIGHT - GAP;

const TIMEFRAMES = ["1D", "5D", "1M", "All"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const FRAME_COUNTS: Record<Timeframe, number> = {
  "1D": 24,
  "5D": 40,
  "1M": 60,
  All: Number.POSITIVE_INFINITY,
};

/**
 * The simulator intentionally keeps a small, human-readable price series. Give
 * the chart enough interpolated samples for its range controls to have distinct
 * windows without changing the simulation or presenting the interpolation as tick
 * data.
 */
const MIN_CHART_POINTS = 96;

function interpolatePrices(prices: number[]): number[] {
  if (prices.length <= 1 || prices.length >= MIN_CHART_POINTS) {
    return prices;
  }

  const target = MIN_CHART_POINTS;
  const values = Array.from({ length: target }, (_, index) => {
    const position = (index / (target - 1)) * (prices.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(prices.length - 1, lower + 1);
    const fraction = position - lower;
    return prices[lower] + (prices[upper] - prices[lower]) * fraction;
  });

  return values;
}

function interpolateSeries(series: (number | null)[], target: number): (number | null)[] {
  if (series.length === 0 || series.length === target) return series;

  return Array.from({ length: target }, (_, index) => {
    const position = (index / Math.max(1, target - 1)) * (series.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(series.length - 1, lower + 1);
    const left = series[lower];
    const right = series[upper];
    if (left === null || left === undefined || right === null || right === undefined) {
      return series[Math.round(position)] ?? null;
    }
    return left + (right - left) * (position - lower);
  });
}

function candlesFromPrices(prices: number[], stepMinutes: number): Candle[] {
  const start = Date.UTC(2025, 4, 12);
  const sampled = interpolatePrices(prices.length > 0 ? prices : [0]);
  const effectiveStep =
    sampled.length > 1 && prices.length > 1
      ? (stepMinutes * (prices.length - 1)) / (sampled.length - 1)
      : stepMinutes;

  return sampled.map((close, index) => {
    const open = index === 0 ? close : sampled[index - 1];
    const movement = Math.abs(close - open);
    const wick = Math.max(0.35, movement * 0.22 + (index % 3) * 0.12);

    return {
      open,
      high: Math.max(open, close) + wick,
      low: Math.max(0, Math.min(open, close) - wick),
      close,
      volume: movement * 0.7 + 3 + (index % 4) * 1.5,
      timestamp: start + index * effectiveStep * 60_000,
    };
  });
}

function priceLabel(value: number): string {
  return money(value);
}

function dateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function percentChange(open: number, close: number): string {
  if (open === 0) return "0.00%";
  return `${close >= open ? "+" : "−"}${Math.abs(((close - open) / open) * 100).toFixed(2)}%`;
}

export interface CandleChartProps {
  /** The same scenario prices used by the simulator's outcome and data table. */
  prices: number[];
  stepMinutes: number;
  /** Optional position-risk lines. They make position edits visible without changing SOL prices. */
  risk?: {
    withAgent: (number | null)[];
    withoutAgent: (number | null)[];
    liquidationLtvBps: number;
  };
  className?: string;
}

/** A compact terminal-style chart driven by the simulator's scenario prices. */
export function CandleChart({ prices, stepMinutes, risk, className }: CandleChartProps) {
  const reduced = useReducedMotion();
  const [timeframe, setTimeframe] = useState<Timeframe>("All");
  const [hover, setHover] = useState<number | null>(null);

  const candles = useMemo(
    () => candlesFromPrices(prices.length > 0 ? prices : [0], stepMinutes),
    [prices, stepMinutes],
  );
  const count = Math.min(FRAME_COUNTS[timeframe], candles.length);
  const view = candles.slice(candles.length - count);
  const viewStart = candles.length - count;
  const riskWithAgent = risk
    ? interpolateSeries(risk.withAgent, candles.length).slice(viewStart, viewStart + count)
    : [];
  const riskWithoutAgent = risk
    ? interpolateSeries(risk.withoutAgent, candles.length).slice(viewStart, viewStart + count)
    : [];
  const activeIndex = hover ?? view.length - 1;
  const active = view[activeIndex];
  const maxVolume = Math.max(...view.map((candle) => candle.volume), 1);
  const maxPrice = Math.max(...view.map((candle) => candle.high));
  const minPrice = Math.min(...view.map((candle) => candle.low));
  const padding = Math.max((maxPrice - minPrice) * 0.08, 1);
  const axisMax = maxPrice + padding;
  const axisMin = Math.max(0, minPrice - padding);
  const axisRange = axisMax - axisMin || 1;
  const slot = PLOT_WIDTH / view.length;
  const bodyWidth = Math.max(2, slot * 0.58);
  const xMid = (index: number) => index * slot + slot / 2;
  const yPrice = (price: number) => ((axisMax - price) / axisRange) * PLOT_HEIGHT;
  const ltvMax = Math.max(10_000, risk?.liquidationLtvBps ?? 0) + 500;
  const yLtv = (value: number) => ((ltvMax - value) / ltvMax) * PLOT_HEIGHT;
  const linePath = (series: (number | null)[]) => {
    let path = "";
    let drawing = false;
    series.forEach((value, index) => {
      if (value === null || value === undefined) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${xMid(index)},${yLtv(value)} `;
      drawing = true;
    });
    return path.trim();
  };
  const ticks = [axisMax, axisMin + axisRange * 0.66, axisMin + axisRange * 0.33, axisMin];
  const dateLabels = Array.from({ length: 6 }, (_, index) =>
    view[Math.min(view.length - 1, Math.floor((index * view.length) / 6))],
  );
  const totalChange = percentChange(view[0].open, view[view.length - 1].close);
  const totalUp = view[view.length - 1].close >= view[0].open;

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    setHover(Math.min(view.length - 1, Math.max(0, Math.floor((x / PLOT_WIDTH) * view.length))));
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            <span>SOL / USD</span>
            <span aria-hidden="true" className="text-ink-faint/50">·</span>
            <span>Scenario market</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="num text-2xl leading-none text-ink">{priceLabel(active.close)}</span>
            <span className={cn("num text-[12px]", totalUp ? "text-state-ok" : "text-state-danger")}>
              {totalChange}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-panel border border-line p-1" role="tablist" aria-label="Chart timeframe">
          {TIMEFRAMES.map((option) => {
            const selected = option === timeframe;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setTimeframe(option);
                  setHover(null);
                }}
                className={cn(
                  "relative rounded-panel px-2.5 py-1 text-[10px] tracking-[0.06em] transition-colors duration-200",
                  selected ? "bg-accent-wash text-ink" : "text-ink-faint hover:text-ink-dim",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative mt-4">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label="SOL price candlestick chart with volume"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={PLOT_WIDTH} y1={yPrice(tick)} y2={yPrice(tick)} stroke="var(--color-line)" strokeWidth={1} />
              <text
                x={WIDTH - 4}
                y={Math.max(10, Math.min(PLOT_HEIGHT - 2, yPrice(tick) + 3))}
                textAnchor="end"
                className="fill-ink-faint text-[10px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {priceLabel(tick)}
              </text>
            </g>
          ))}

          <line
            x1={0}
            x2={PLOT_WIDTH}
            y1={yPrice(view[view.length - 1].close)}
            y2={yPrice(view[view.length - 1].close)}
            stroke={totalUp ? UP : DOWN}
            strokeOpacity="0.45"
            strokeDasharray="2 4"
          />

          <motion.g
            initial={reduced ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            {view.map((candle, index) => {
              const up = candle.close >= candle.open;
              const color = up ? UP : DOWN;
              const top = yPrice(Math.max(candle.open, candle.close));
              const bottom = yPrice(Math.min(candle.open, candle.close));
              const dimmed = hover !== null && hover !== index;
              const volumeHeight = (candle.volume / maxVolume) * VOLUME_HEIGHT;

              return (
                <g key={`${candle.timestamp}-${index}`} opacity={dimmed ? 0.42 : 1}>
                  <line
                    x1={xMid(index)}
                    x2={xMid(index)}
                    y1={yPrice(candle.high)}
                    y2={yPrice(candle.low)}
                    stroke={color}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect x={xMid(index) - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1.5, bottom - top)} fill={color} />
                  <rect
                    x={xMid(index) - bodyWidth / 2}
                    y={PLOT_HEIGHT + GAP + VOLUME_HEIGHT - volumeHeight}
                    width={bodyWidth}
                    height={volumeHeight}
                    fill={color}
                    fillOpacity="0.55"
                  />
                </g>
              );
            })}
          </motion.g>

          {risk ? (
            <g pointerEvents="none" opacity="0.9">
              <path d={linePath(riskWithoutAgent)} fill="none" stroke="var(--color-ink-dim)" strokeDasharray="5 4" strokeWidth={1.5} />
              <path d={linePath(riskWithAgent)} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
              <line x1={0} x2={PLOT_WIDTH} y1={yLtv(risk.liquidationLtvBps)} y2={yLtv(risk.liquidationLtvBps)} stroke="var(--color-state-danger)" strokeDasharray="2 4" strokeOpacity="0.5" />
            </g>
          ) : null}

          <line x1={0} x2={PLOT_WIDTH} y1={PLOT_HEIGHT + GAP} y2={PLOT_HEIGHT + GAP} stroke="var(--color-line)" />

          {hover !== null ? (
            <g pointerEvents="none">
              <line x1={xMid(hover)} x2={xMid(hover)} y1={0} y2={HEIGHT} stroke="var(--color-line-strong)" strokeWidth={1} />
              <line x1={0} x2={PLOT_WIDTH} y1={yPrice(active.close)} y2={yPrice(active.close)} stroke="var(--color-line-strong)" strokeDasharray="3 3" strokeWidth={1} />
              <circle cx={xMid(hover)} cy={yPrice(active.close)} r={3} fill={active.close >= active.open ? UP : DOWN} />
            </g>
          ) : null}
        </svg>

        {hover !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[142px] rounded-panel border border-line bg-raised px-3 py-2.5 shadow-2xl"
            style={{
              left: `${Math.min(82, Math.max(5, (xMid(hover) / WIDTH) * 100))}%`,
              transform: hover > view.length / 2 ? "translateX(-105%)" : "translateX(5%)",
            }}
            role="status"
          >
            <div className="text-[10px] text-ink-faint">{dateLabel(active.timestamp)}</div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <dt className="text-ink-faint">Open</dt><dd className="num text-right text-ink">{priceLabel(active.open)}</dd>
              <dt className="text-ink-faint">High</dt><dd className="num text-right text-ink">{priceLabel(active.high)}</dd>
              <dt className="text-ink-faint">Low</dt><dd className="num text-right text-ink">{priceLabel(active.low)}</dd>
              <dt className="text-ink-faint">Close</dt><dd className="num text-right text-ink">{priceLabel(active.close)}</dd>
              <dt className="text-ink-faint">Change</dt>
              <dd className={cn("num text-right", active.close >= active.open ? "text-state-ok" : "text-state-danger")}>
                {percentChange(active.open, active.close)}
              </dd>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex justify-between border-t border-line pt-2 pr-[58px]">
        {dateLabels.map((candle, index) => (
          <span key={`${candle.timestamp}-${index}`} className="num text-[10px] text-ink-faint">
            {dateLabel(candle.timestamp)}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-ink-dim">
        <span className="flex items-center gap-2"><i aria-hidden="true" className="size-2 rounded-sm bg-state-ok" /> Up</span>
        <span className="flex items-center gap-2"><i aria-hidden="true" className="size-2 rounded-sm bg-state-danger" /> Down</span>
        <span className="text-ink-faint">Volume</span>
        {risk ? (
          <>
            <span className="flex items-center gap-2"><i aria-hidden="true" className="h-px w-3 bg-accent" /> LTV with agent</span>
            <span className="flex items-center gap-2"><i aria-hidden="true" className="h-px w-3 border-t border-dashed border-ink-dim" /> LTV without agent</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
