import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, moneySigned, moneyWhole } from "@/lib/core/format";
import type { Branch, SimulationResult } from "@/lib/core/ltv/simulate";

/**
 * The two numbers LANDING.md asks for, side by side, plus the three that
 * explain them. The difference is stated last and it is allowed to be
 * negative: on two of the three scenarios it is.
 */
function BranchColumn({
  title,
  branch,
  prices,
  emphasis,
}: {
  title: string;
  branch: Branch;
  prices: number[];
  emphasis: boolean;
}) {
  const liquidated = branch.liquidatedAt !== null;

  return (
    <div className="bg-canvas p-5">
      <p className="text-[11px] text-ink-faint">{title}</p>
      {/*
        Whole dollars, not cents. Two of these sit side by side in a narrow
        column, and "$4,644.10" at this size overflowed it. Cents on a
        final-equity comparison were noise anyway; the difference row below
        keeps them.
      */}
      <p
        className={cn(
          "num mt-2 text-2xl leading-none",
          emphasis ? "text-ink" : "text-ink-dim",
        )}
      >
        {moneyWhole(branch.finalEquity)}
      </p>

      <dl className="mt-5 flex flex-col gap-2 text-[12px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-faint">{en.simulator.reserveLeft}</dt>
          <dd className="num text-ink-dim">{money(branch.reserveLeft)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-faint">{en.simulator.actionsTaken}</dt>
          <dd className="num text-ink-dim">{branch.actions.length}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-faint">{en.simulator.feesPaid}</dt>
          <dd className="num text-ink-dim">{moneyPrecise(branch.feesPaid)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-faint">Outcome</dt>
          {/*
           * The word carries the meaning. The colour only tints a word that
           * already says which state this is, because the ok and danger tokens
           * are not separable under deuteranopia.
           */}
          <dd className={cn("num", liquidated ? "text-state-danger" : "text-state-ok")}>
            {liquidated
              ? `${en.simulator.liquidatedAt} $${prices[branch.liquidatedAt!].toFixed(2)}`
              : en.simulator.survived}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Difference({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-3">
      <span className="text-[12px] text-ink-dim">{label}</span>
      <span className={cn("num text-lg", value < 0 ? "text-state-danger" : "text-ink")}>
        {moneySigned(value)}
      </span>
    </div>
  );
}

export function Outcome({ result }: { result: SimulationResult }) {
  const prepaid = result.reservePrepaid;

  return (
    <div>
      <h3 className="text-[13px] text-ink">{en.simulator.resultHeading}</h3>

      <div className="mt-4 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2">
        <BranchColumn
          title={en.simulator.withAgent}
          branch={result.withAgent}
          prices={result.prices}
          emphasis
        />
        <BranchColumn
          title={en.simulator.withoutAgent}
          branch={result.withoutAgent}
          prices={result.prices}
          emphasis={false}
        />
      </div>

      {/*
        Its own row rather than a third column. This is a different question from
        the other two - not "did the agent act" but "what if you had spent the
        money instead" - and three columns in this width could not hold the
        numbers legibly anyway.
      */}
      <div className="mt-4 rounded-panel border border-line px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[11px] text-ink-faint">{en.simulator.reservePrepaid}</p>
          <p className="num text-2xl leading-none text-ink-dim">
            {moneyWhole(prepaid.finalEquity)}
          </p>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
          {en.simulator.reservePrepaidNote}
        </p>
      </div>

      <div className="mt-4 divide-y divide-line overflow-hidden rounded-panel border border-line">
        <Difference
          label={en.simulator.vsNothing}
          value={result.withAgent.finalEquity - result.withoutAgent.finalEquity}
        />
        <Difference
          label={en.simulator.vsPrepaid}
          value={result.withAgent.finalEquity - prepaid.finalEquity}
        />
      </div>
    </div>
  );
}
