import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, moneySigned } from "@/lib/core/format";
import type { Branch, SimulationResult } from "@/lib/core/ltv/simulate";

/**
 * One branch of the simulation: what the money was worth at the end, and the
 * four figures that explain how it got there.
 *
 * `note` is only passed for the reserve-prepaid branch, which needs one line to
 * say what it is. The other two are named by their titles.
 */
function BranchColumn({
  title,
  branch,
  prices,
  emphasis,
  note,
}: {
  title: string;
  branch: Branch;
  prices: number[];
  emphasis: boolean;
  note?: string;
}) {
  const liquidated = branch.liquidatedAt !== null;

  return (
    <div className="bg-canvas p-5">
      <p className="text-[11px] text-ink-faint">{title}</p>
      {/* Cents are back. They were dropped when three of these had to share a
          360px sidebar; at a third of the full width they fit. */}
      <p
        className={cn(
          "num mt-2 text-2xl leading-none",
          emphasis ? "text-ink" : "text-ink-dim",
        )}
      >
        {money(branch.finalEquity)}
      </p>

      {note ? (
        <p className="mt-2 max-w-[34ch] text-[12px] leading-snug text-ink-faint">{note}</p>
      ) : null}

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
    <div className="mt-10">
      <h3 className="text-[13px] text-ink">{en.simulator.resultHeading}</h3>

      {/*
        Three branches across, then the two differences beside them. This block
        used to live in a 360px sidebar, where three columns could not hold the
        figures and the reserve-prepaid case had to be demoted to its own row.
        At full width all three read as what they are: the same money, spent
        three ways.
      */}
      <div className="mt-4 grid gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-3">
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
        <BranchColumn
          title={en.simulator.reservePrepaid}
          branch={prepaid}
          prices={result.prices}
          emphasis={false}
          note={en.simulator.reservePrepaidNote}
        />
      </div>

      <div className="mt-4 grid overflow-hidden rounded-panel border border-line sm:grid-cols-2 sm:divide-x sm:divide-line">
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
