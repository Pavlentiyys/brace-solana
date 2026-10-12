"use client";

import Link from "next/link";
import { Pause, Play, TrendDown, TrendUp } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { Card, CardTitle, Note, PageHeading, StatusDot, StatusWord } from "@/components/app/ui";
import { ConnectGate } from "@/components/app/connect";
import { cn } from "@/lib/cn";
import { money, percentFromBps } from "@/lib/core/format";
import { dropToLtv, priceAtLtv } from "@/lib/core/guard";
import { positionLtvBps } from "@/lib/core/position";
import { formatAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { usePlatform, useSelectedPosition } from "@/lib/platform/provider";

type Range = "24H" | "7D" | "30D";

const RANGES: Range[] = ["24H", "7D", "30D"];

const RANGE_CONFIG: Record<Range, { points: number; drift: number; volatility: number }> = {
  "24H": { points: 28, drift: 0.024, volatility: 0.010 },
  "7D": { points: 36, drift: 0.062, volatility: 0.018 },
  "30D": { points: 44, drift: 0.118, volatility: 0.030 },
};

const REFERENCE_ASSETS = [
  { symbol: "SOL", name: "Solana", price: 167.84, change: 2.86 },
  { symbol: "BTC", name: "Bitcoin", price: 102_480, change: 1.42 },
  { symbol: "ETH", name: "Ethereum", price: 3_640.12, change: -0.64 },
  { symbol: "JitoSOL", name: "Liquid staking", price: 191.28, change: 2.12 },
] as const;

function buildSeries(price: number, range: Range): number[] {
  const { points, drift, volatility } = RANGE_CONFIG[range];
  const start = price / (1 + drift);

  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    const wave = Math.sin(index * 1.47) * volatility + Math.cos(index * 0.58) * volatility * 0.42;
    return start + (price - start) * progress + price * wave * (1 - progress * 0.18);
  });
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
}

function metricTone(value: number): "ok" | "danger" {
  return value >= 0 ? "ok" : "danger";
}

function MarketChart({ prices, range, onRangeChange }: { prices: number[]; range: Range; onRangeChange: (range: Range) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 900;
  const height = 286;
  const pad = { top: 24, right: 76, bottom: 34, left: 0 };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const floor = min - Math.max((max - min) * 0.16, 1);
  const ceiling = max + Math.max((max - min) * 0.16, 1);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (index: number) => pad.left + (index / Math.max(1, prices.length - 1)) * plotWidth;
  const y = (price: number) => pad.top + ((ceiling - price) / Math.max(1, ceiling - floor)) * plotHeight;
  const line = prices.map((price, index) => `${x(index)},${y(price)}`).join(" ");
  const area = `${pad.left},${height - pad.bottom} ${line} ${x(prices.length - 1)},${height - pad.bottom}`;
  const activeIndex = hover ?? prices.length - 1;
  const activePrice = prices[activeIndex];
  const change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  const yTicks = [ceiling, ceiling - (ceiling - floor) / 2, floor];

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setHover(Math.round(position * (prices.length - 1)));
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            <span>SOL / USD</span>
            <span aria-hidden="true" className="text-ink-faint/50">·</span>
            <span>Reference feed</span>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="num text-3xl leading-none text-ink">{money(activePrice)}</span>
            <span className={cn("num text-[12px]", metricTone(change) === "ok" ? "text-state-ok" : "text-state-danger")}>
              {signedPercent(change)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-panel border border-line p-1" role="tablist" aria-label="Chart range">
          {RANGES.map((option) => {
            const selected = option === range;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setHover(null);
                  onRangeChange(option);
                }}
                className={cn(
                  "min-h-8 rounded-panel px-3 text-[10px] tracking-[0.06em] transition-colors duration-200",
                  selected ? "bg-accent-wash text-ink" : "text-ink-faint hover:text-ink-dim",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 rounded-panel border border-line bg-canvas p-2 sm:p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={`SOL reference price chart for ${range}. Current value ${money(prices[prices.length - 1])}. Change ${signedPercent(change)}.`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="analytics-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
              <text x={width - 4} y={y(tick) + 4} textAnchor="end" className="fill-ink-faint text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
                {money(tick)}
              </text>
            </g>
          ))}
          <polygon points={area} fill="url(#analytics-area)" />
          <polyline points={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null ? (
            <>
              <line x1={x(activeIndex)} x2={x(activeIndex)} y1={pad.top} y2={height - pad.bottom} stroke="var(--color-line-strong)" strokeDasharray="3 4" />
              <circle cx={x(activeIndex)} cy={y(activePrice)} r="4" fill="var(--color-canvas)" stroke="var(--color-accent)" strokeWidth="2" />
            </>
          ) : null}
          <text x={pad.left} y={height - 8} className="fill-ink-faint text-[10px]">Earlier</text>
          <text x={width - pad.right} y={height - 8} textAnchor="end" className="fill-ink-faint text-[10px]">Now</text>
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Note>Reference series for interface context. Connect a market history source before using it for decisions.</Note>
        <span className="num text-[11px] text-ink-faint">high {money(Math.max(...prices))} · low {money(Math.min(...prices))}</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "ok" | "danger" }) {
  return (
    <Card className="min-w-0">
      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <p className={cn("num mt-3 truncate text-xl", tone === "ok" ? "text-state-ok" : tone === "danger" ? "text-state-danger" : "text-ink")}>
        {value}
      </p>
      <p className="mt-1 text-[12px] text-ink-dim">{detail}</p>
    </Card>
  );
}

function RiskSnapshot() {
  const { snapshot, entry, failure, isLoading } = useSelectedPosition();
  const { status } = usePlatform();
  const position = entry?.position;
  const guard = entry?.guard;

  if (status !== "connected") {
    return (
      <Card className="flex min-h-[250px] flex-col justify-between">
        <div>
          <CardTitle>Position risk</CardTitle>
          <p className="mt-4 text-[14px] leading-relaxed text-ink">Connect a wallet to compare market price with your live collateral thresholds.</p>
        </div>
        <ConnectGate>{null}</ConnectGate>
      </Card>
    );
  }

  if (failure) {
    return (
      <Card className="min-h-[250px]">
        <CardTitle>Position risk</CardTitle>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-dim">The position snapshot could not be read. Open Chat for the full failure detail and retry path.</p>
        <Link href="/app" className="mt-4 inline-block text-[13px] text-accent underline-offset-4 hover:underline">Open the app</Link>
      </Card>
    );
  }

  if (isLoading || !snapshot) {
    return <Card className="min-h-[250px]"><CardTitle>Position risk</CardTitle><p className="mt-4 text-[13px] text-ink-dim">Reading the selected position…</p></Card>;
  }

  if (!position || !entry?.supported) {
    return (
      <Card className="min-h-[250px]">
        <CardTitle>Position risk</CardTitle>
        <p className="mt-4 text-[14px] leading-relaxed text-ink">No supported borrow is selected yet.</p>
        <Link href="/app" className="mt-4 inline-block text-[13px] text-accent underline-offset-4 hover:underline">Open the app</Link>
      </Card>
    );
  }

  const ltv = positionLtvBps(position);
  const trigger = guard?.policy.triggerLtvBps ?? position.liquidationLtvBps;
  const triggerPrice = priceAtLtv(position.collateralPrice, ltv, trigger);
  const liquidationPrice = priceAtLtv(position.collateralPrice, ltv, position.liquidationLtvBps);
  const liquidationDistance = dropToLtv(ltv, position.liquidationLtvBps) * 100;

  return (
    <Card>
      <CardTitle right={<StatusWord tone={guard ? "ok" : "neutral"}>{guard ? "Guarded" : "Not guarded"}</StatusWord>}>Position risk</CardTitle>
      <p className="mt-3 text-[14px] text-ink">{position.market}</p>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-ink-faint">Current LTV</p>
          <p className="num mt-1 text-2xl text-ink">{percentFromBps(ltv)}</p>
        </div>
        <div>
          <p className="text-[11px] text-ink-faint">To liquidation</p>
          <p className="num mt-1 text-2xl text-ink">{liquidationDistance.toFixed(1)}%</p>
        </div>
      </div>
      <dl className="mt-5 divide-y divide-line border-t border-line">
        <div className="flex items-center justify-between gap-3 py-2.5 text-[12px]"><dt className="text-ink-dim">Rule trigger</dt><dd className="num text-ink">{percentFromBps(trigger)} <span className="text-ink-faint">at {money(triggerPrice)}</span></dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5 text-[12px]"><dt className="text-ink-dim">Liquidation</dt><dd className="num text-state-danger">{percentFromBps(position.liquidationLtvBps)} <span className="text-ink-faint">at {money(liquidationPrice)}</span></dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5 text-[12px]"><dt className="text-ink-dim">Reserve</dt><dd className="num text-ink">{formatAmount(snapshot.reserveBalance, QUOTE_DECIMALS)} {QUOTE_SYMBOL}</dd></div>
      </dl>
      <Link href="/app" className="mt-4 inline-block text-[13px] text-accent underline-offset-4 hover:underline">Open the position</Link>
    </Card>
  );
}

export function CryptoAnalytics() {
  const { world } = usePlatform();
  const { entry } = useSelectedPosition();
  const [range, setRange] = useState<Range>("24H");
  const [paused, setPaused] = useState(false);
  const [pulse, setPulse] = useState(0);
  const spot = entry?.position.collateralPrice ?? REFERENCE_ASSETS[0].price;
  const prices = useMemo(() => buildSeries(spot, range), [spot, range]);
  const change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const volatility = ((high - low) / prices[0]) * 100;

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setPulse((current) => current + 1), 12_000);
    return () => window.clearInterval(timer);
  }, [paused]);

  const updatedLabel = pulse === 0 ? "just now" : `${pulse * 12}s ago`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-6 pb-10">
        <PageHeading
          title="Market analytics"
          lead="A compact view of SOL market context and the thresholds that matter to your position."
          right={
            <div className="flex items-center gap-3 text-[12px] text-ink-faint">
              <span className="flex items-center gap-2"><StatusDot tone={paused ? "neutral" : "ok"} />{paused ? "Updates paused" : "Updating"}</span>
              <button type="button" onClick={() => setPaused((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-panel border border-line-strong px-3 text-ink transition-colors duration-200 hover:border-accent" aria-pressed={paused}>
                {paused ? <Play size={14} weight="bold" aria-hidden="true" /> : <Pause size={14} weight="bold" aria-hidden="true" />}
                {paused ? "Resume" : "Pause"}
              </button>
            </div>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="SOL spot" value={money(prices[prices.length - 1])} detail={`Updated ${updatedLabel}`} />
          <StatCard label={`${range} change`} value={signedPercent(change)} detail="Reference window" tone={metricTone(change)} />
          <StatCard label="Range high / low" value={`${money(high)} / ${money(low)}`} detail={`${volatility.toFixed(1)}% spread`} />
          <StatCard label="Feed state" value={world === "demo" ? "Demo" : "Connected"} detail={world === "demo" ? "Synthetic reference data" : "Wallet-linked view"} tone="ok" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.8fr)]">
          <Card>
            <CardTitle right={<span className="num text-[11px] text-ink-faint">{range} · SOL/USD</span>}>Market pulse</CardTitle>
            <div className="mt-5"><MarketChart prices={prices} range={range} onRangeChange={setRange} /></div>
          </Card>
          <RiskSnapshot />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardTitle>Reference assets</CardTitle>
            <div className="mt-3 divide-y divide-line">
              {REFERENCE_ASSETS.map((asset) => (
                <div key={asset.symbol} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-panel border border-line bg-raised text-[10px] text-ink">{asset.symbol.slice(0, 2)}</span>
                    <div className="min-w-0"><p className="truncate text-[13px] text-ink">{asset.symbol}</p><p className="truncate text-[11px] text-ink-faint">{asset.name}</p></div>
                  </div>
                  <div className="text-right"><p className="num text-[13px] text-ink">{money(asset.price)}</p><p className={cn("num mt-0.5 text-[11px]", asset.change >= 0 ? "text-state-ok" : "text-state-danger")}>{signedPercent(asset.change)}</p></div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle>Market signals</CardTitle>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-panel border border-line bg-raised p-3"><TrendUp size={16} className="text-state-ok" aria-hidden="true" /><p className="mt-3 text-[11px] uppercase tracking-[0.08em] text-ink-faint">Trend</p><p className="mt-1 text-[14px] text-ink">Constructive</p></div>
              <div className="rounded-panel border border-line bg-raised p-3"><TrendDown size={16} className="text-state-danger" aria-hidden="true" /><p className="mt-3 text-[11px] uppercase tracking-[0.08em] text-ink-faint">Volatility</p><p className="num mt-1 text-[14px] text-ink">{volatility.toFixed(1)}%</p></div>
            </div>
            <dl className="mt-4 divide-y divide-line border-t border-line">
              <div className="flex items-center justify-between py-2.5 text-[12px]"><dt className="text-ink-dim">Window support</dt><dd className="num text-ink">{money(low)}</dd></div>
              <div className="flex items-center justify-between py-2.5 text-[12px]"><dt className="text-ink-dim">Window resistance</dt><dd className="num text-ink">{money(high)}</dd></div>
            </dl>
            <Note className="mt-3">Signals describe this reference window. They are not forecasts and do not replace your position rule.</Note>
          </Card>
        </div>
      </div>
    </div>
  );
}
