"use client";

import { useMemo, useState } from "react";

import { DataTable } from "@/components/simulator/data-table";
import { Outcome } from "@/components/simulator/outcome";
import { SimulatorChart } from "@/components/simulator/simulator-chart";
import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { money, percentFromBps } from "@/lib/core/format";
import { liquidationPrice, ltvBps, type Position } from "@/lib/core/ltv/calc";
import { simulate } from "@/lib/core/ltv/simulate";
import {
  DEFAULT_SCENARIO_ID,
  DEMO_MARKET,
  DEMO_POSITION,
  DEMO_RESERVE,
  DEMO_RULE,
  SCENARIOS,
  getScenario,
} from "@/lib/scenarios";

/**
 * The public simulator. No wallet, no connection, nothing to approve.
 *
 * Lives under `components/simulator` rather than under `components/landing`
 * because LANDING.md section 5 requires the landing page and the app to run
 * the same component rather than two copies that drift apart.
 *
 * It is a client component, so it hydrates for the controls, but nothing here
 * is gated behind an effect. The server renders the default scenario complete,
 * which is what a reader with scripts disabled keeps.
 */

function NumberField({
  label,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const id = `sim-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[11px] text-ink-faint">
        {label}
      </label>
      <div className="flex items-center rounded-panel border border-line bg-surface focus-within:border-accent">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
          className="num w-full bg-transparent px-3 py-2.5 text-[14px] text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="num shrink-0 pr-3 text-[12px] text-ink-faint">{suffix}</span>
      </div>
    </div>
  );
}

export function Simulator() {
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const [collateral, setCollateral] = useState(DEMO_POSITION.collateral);
  const [debt, setDebt] = useState(DEMO_POSITION.debt);
  const [reserve, setReserve] = useState(DEMO_RESERVE);

  const scenario = getScenario(scenarioId);

  const position: Position = useMemo(
    () => ({ collateral, debt, liquidationLtvBps: DEMO_POSITION.liquidationLtvBps }),
    [collateral, debt],
  );

  const result = useMemo(
    () =>
      simulate({
        position,
        reserve,
        prices: scenario.prices,
        rule: DEMO_RULE,
        market: DEMO_MARKET,
      }),
    [position, reserve, scenario],
  );

  const startPrice = scenario.prices[0];
  const startLtv = ltvBps(position, startPrice);
  const liqPrice = liquidationPrice(position);
  const takeaway = en.simulator.takeaways[scenario.id];
  const edited =
    collateral !== DEMO_POSITION.collateral ||
    debt !== DEMO_POSITION.debt ||
    reserve !== DEMO_RESERVE;

  return (
    <div className="mt-10">
      {/* The harmful scenarios sit in the same switch as the good one, not in
          a footnote. LANDING.md section 2, screen 2. */}
      <div
        role="group"
        aria-label={en.simulator.scenarioLabel}
        className="flex flex-wrap gap-2"
      >
        {SCENARIOS.map((option) => {
          const active = option.id === scenario.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setScenarioId(option.id)}
              className={cn(
                "rounded-panel border px-3.5 py-2 text-[13px] transition-colors duration-300",
                active
                  ? "border-accent bg-accent-wash text-ink"
                  : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[13px] text-ink-dim">
        {scenario.market}{" "}
        <span className="text-ink-faint">{scenario.basis}</span>
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
        <div className="min-w-0 rounded-panel border border-line bg-surface p-4 md:p-6">
          <SimulatorChart
            result={result}
            liquidationLtvBps={position.liquidationLtvBps}
            triggerLtvBps={DEMO_RULE.steps[0].triggerLtvBps}
            stepMinutes={scenario.stepMinutes}
          />
        </div>

        <div className="flex flex-col gap-8">
          <div>
            <h3 className="text-[13px] text-ink">{en.simulator.positionHeading}</h3>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <NumberField
                label="Collateral"
                suffix="SOL"
                value={collateral}
                min={1}
                max={10_000}
                step={1}
                onChange={setCollateral}
              />
              <NumberField
                label="Debt"
                suffix="USD"
                value={debt}
                min={0}
                max={1_000_000}
                step={100}
                onChange={setDebt}
              />
              <NumberField
                label="Reserve"
                suffix="USD"
                value={reserve}
                min={0}
                max={1_000_000}
                step={100}
                onChange={setReserve}
              />
              <div className="flex flex-col gap-2">
                <span className="text-[11px] text-ink-faint">Starting LTV</span>
                <span className="num rounded-panel border border-transparent px-3 py-2.5 text-[14px] text-ink">
                  {percentFromBps(startLtv)}
                </span>
              </div>
            </div>

            <dl className="mt-5 flex flex-col gap-2 border-t border-line pt-4 text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-faint">Liquidation at</dt>
                <dd className="num text-ink-dim">{money(liqPrice)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-faint">Your rule fires at</dt>
                <dd className="num text-ink-dim">
                  {percentFromBps(DEMO_RULE.steps[0].triggerLtvBps)} LTV
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-faint">Then repays at</dt>
                <dd className="num text-ink-dim">
                  {percentFromBps(DEMO_RULE.steps[1].triggerLtvBps)} LTV
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
              The rule is fixed here because you set yours in the chat, not in a form. The
              position is yours to change.
            </p>
          </div>

          <Outcome result={result} />
        </div>
      </div>

      <DataTable result={result} stepMinutes={scenario.stepMinutes} />

      {/* The takeaway is written for the shipped position. Editing the inputs
          changes the numbers it quotes, so it steps aside rather than lying. */}
      {edited ? (
        <p className="mt-6 max-w-[70ch] text-[13px] leading-relaxed text-ink-faint">
          You have changed the position, so the written summary for this scenario no longer
          matches the numbers above. The chart and the outcome are recalculated from what you
          entered.
        </p>
      ) : takeaway ? (
        <p className="mt-6 max-w-[70ch] text-[13px] leading-relaxed text-ink-dim">{takeaway}</p>
      ) : null}
    </div>
  );
}
