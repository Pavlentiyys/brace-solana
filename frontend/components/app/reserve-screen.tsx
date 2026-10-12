"use client";

import { useState } from "react";

import { FailureNotice } from "@/components/app/failure-notice";
import { ActionButton, Card, CardTitle, Note, Row, Rows } from "@/components/app/ui";
import { en } from "@/content/en";
import { percentFromBps } from "@/lib/core/format";
import { coverage, firingsLeft, furthestCoveredDrop, minimumForOneAction } from "@/lib/core/reserve";
import { formatAmount, parseAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { useGuardAction, useSelectedPosition } from "@/lib/platform/provider";
import type { Outcome } from "@/lib/platform/types";

/**
 * Screen 2.4.
 *
 * Two jobs, and the second one is the one that matters. Moving money in and out is
 * mechanical. Telling the user what the amount BUYS is the part that stops a reserve
 * being a number somebody guessed, and it is why the sizing table is computed from
 * the live position rather than quoted from a table of examples.
 *
 * The withdrawal side is deliberately as prominent as the funding side and carries
 * no warning. Section 7 requires withdrawal to work while the agent is paused,
 * expired or revoked, and an interface that treats leaving as the dangerous path
 * argues against the property the program was built to have.
 */

const copy = en.app.reserve;

function AmountField({
  label,
  value,
  onChange,
  onMax,
  problem,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onMax: () => void;
  problem: string | null;
}) {
  const id = `amount-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[11px] text-ink-faint">
        {label}
      </label>
      <div className="flex items-center rounded-panel border border-line bg-canvas focus-within:border-accent">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          className="num min-h-11 w-full bg-transparent px-3 text-[14px] text-ink outline-none"
        />
        <span className="num shrink-0 pr-2 text-[12px] text-ink-faint">{QUOTE_SYMBOL}</span>
        <button
          type="button"
          onClick={onMax}
          className="min-h-11 shrink-0 border-l border-line px-3 text-[12px] text-ink-dim transition-colors duration-300 hover:text-ink"
        >
          {copy.max}
        </button>
      </div>
      {problem ? <p className="text-[12px] text-state-danger">{problem}</p> : null}
    </div>
  );
}

const PARSE_MESSAGES: Record<string, string> = {
  not_a_number: "That is not an amount.",
  negative: "Amounts are positive.",
  too_precise: `${QUOTE_SYMBOL} has six decimal places, so this is more precision than the token has.`,
};

function useAmount() {
  const [text, setText] = useState("");
  const parsed = text.trim() === "" ? null : parseAmount(text, QUOTE_DECIMALS);
  const amount = parsed?.ok ? parsed.amount : null;
  const problem = parsed && !parsed.ok ? (PARSE_MESSAGES[parsed.reason] ?? null) : null;
  return { text, setText, amount, problem };
}

function Result({ outcome }: { outcome: Outcome | undefined }) {
  if (!outcome) return null;
  if (outcome.ok) return <p className="mt-3 text-[13px] text-state-ok">Done.</p>;
  return <FailureNotice className="mt-3" failure={outcome.failure} />;
}

export function ReserveScreen() {
  const { entry, snapshot, failure } = useSelectedPosition();
  const deposit = useAmount();
  const withdraw = useAmount();

  const obligation = entry?.position.obligation ?? "";
  const depositAction = useGuardAction((source) =>
    source.deposit({ obligation, amount: deposit.amount ?? 0n }),
  );
  const withdrawAction = useGuardAction((source) =>
    source.withdraw({ obligation, amount: withdraw.amount }),
  );
  const withdrawAll = useGuardAction((source) => source.withdraw({ obligation, amount: null }));

  if (failure && !snapshot) return <FailureNotice failure={failure} />;
  if (!snapshot || !entry) return <Note>Reading your position</Note>;

  const { position, guard } = entry;
  const reserveBalance = snapshot.reserveBalance;
  const policy = guard?.policy ?? null;

  const perAction = policy ? minimumForOneAction(position, policy) : null;
  const rows = policy ? coverage(position, policy, reserveBalance) : [];
  const depth = policy ? furthestCoveredDrop(position, policy, reserveBalance) : null;

  return (
    <div className="flex flex-col gap-6">
      <Note className="max-w-[70ch]">{copy.lead}</Note>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>{copy.balance}</CardTitle>
          <p className="num mt-3 text-3xl text-ink">
            {formatAmount(reserveBalance, QUOTE_DECIMALS)}{" "}
            <span className="text-[13px] text-ink-faint">{QUOTE_SYMBOL}</span>
          </p>
          {perAction !== null ? (
            <Note className="mt-2">
              {firingsLeft(reserveBalance, perAction)} firings left at the current rule.
            </Note>
          ) : null}
        </Card>
        <Card>
          <CardTitle>{copy.walletBalance}</CardTitle>
          <p className="num mt-3 text-3xl text-ink">
            {formatAmount(snapshot.walletBalance, QUOTE_DECIMALS)}{" "}
            <span className="text-[13px] text-ink-faint">{QUOTE_SYMBOL}</span>
          </p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{copy.depositHeading}</CardTitle>
          <div className="mt-4">
            <AmountField
              label={copy.amount}
              value={deposit.text}
              onChange={deposit.setText}
              onMax={() =>
                deposit.setText(
                  formatAmount(snapshot.walletBalance, QUOTE_DECIMALS, {
                    maxFractionDigits: 6,
                    group: false,
                  }),
                )
              }
              problem={deposit.problem}
            />
          </div>
          <ActionButton
            className="mt-4"
            variant="primary"
            busy={depositAction.isPending}
            disabled={!guard || deposit.amount === null || deposit.amount <= 0n}
            onClick={() => depositAction.mutate()}
          >
            {copy.deposit}
          </ActionButton>
          {!guard ? (
            <Note className="mt-3">
              There is no authorization for this position yet, so there is no vault to fund.
            </Note>
          ) : null}
          <Result outcome={depositAction.data} />
        </Card>

        <Card>
          <CardTitle>{copy.withdrawHeading}</CardTitle>
          <div className="mt-4">
            <AmountField
              label={copy.amount}
              value={withdraw.text}
              onChange={withdraw.setText}
              onMax={() =>
                withdraw.setText(
                  formatAmount(reserveBalance, QUOTE_DECIMALS, {
                    maxFractionDigits: 6,
                    group: false,
                  }),
                )
              }
              problem={withdraw.problem}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <ActionButton
              busy={withdrawAction.isPending}
              disabled={withdraw.amount === null || withdraw.amount <= 0n}
              onClick={() => withdrawAction.mutate()}
            >
              {copy.withdraw}
            </ActionButton>
            <ActionButton
              busy={withdrawAll.isPending}
              disabled={reserveBalance <= 0n}
              onClick={() => withdrawAll.mutate()}
            >
              {copy.withdrawAll}
            </ActionButton>
          </div>
          <Result outcome={withdrawAction.data} />
          <Result outcome={withdrawAll.data} />
        </Card>
      </div>

      {policy && perAction !== null ? (
        <Card>
          <CardTitle>{copy.sizingHeading}</CardTitle>
          <Rows>
            <Row
              label={copy.oneAction}
              value={`${formatAmount(perAction, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
            />
          </Rows>
          <Note className="mt-2">{copy.oneActionNote}</Note>

          <p className="mt-6 text-[12px] uppercase tracking-[0.08em] text-ink-faint">
            {copy.coverageHeading}
          </p>

          {/* Stacked on a phone, four columns from `sm`. A table that scrolls
              sideways at 375px fails the acceptance list. */}
          <ul className="mt-3 divide-y divide-line">
            {rows.map((row) => (
              <li
                key={row.drop}
                className="grid grid-cols-2 gap-x-4 gap-y-2 py-3 sm:grid-cols-4 sm:items-baseline"
              >
                <div>
                  <p className="text-[11px] text-ink-faint sm:hidden">{copy.coverageDrop}</p>
                  <p className="num text-[13px] text-ink">{(row.drop * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-[11px] text-ink-faint sm:hidden">{copy.coverageLtv}</p>
                  <p className="num text-[13px] text-ink-dim">
                    {percentFromBps(row.ltvBpsAfterDrop)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-ink-faint sm:hidden">{copy.coverageNeeded}</p>
                  <p className="num text-[13px] text-ink-dim">
                    {row.ruleFires
                      ? `${formatAmount(row.required, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`
                      : copy.noFire}
                  </p>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-[11px] text-ink-faint sm:hidden">{copy.coverageStatus}</p>
                  <p
                    className={
                      row.covered ? "text-[13px] text-state-ok" : "text-[13px] text-state-danger"
                    }
                  >
                    {row.covered
                      ? copy.covered
                      : `${copy.notCovered} ${formatAmount(row.shortfall, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
                  </p>
                  {/* Money is one limit and the rule is another. A fall the reserve
                      can afford but the rule cannot deliver reads as covered
                      otherwise. */}
                  {row.ruleFires && !row.withinRuleLimits ? (
                    <p className="mt-1 text-[12px] text-state-warn">
                      {copy.beyondRule} {formatAmount(row.perWindowCeiling, QUOTE_DECIMALS)}{" "}
                      {QUOTE_SYMBOL}
                    </p>
                  ) : null}
                  {row.passesLiquidation ? (
                    <p className="mt-1 text-[12px] text-state-warn">{copy.passesLiquidation}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <Note className="mt-4">
            {reserveBalance <= 0n
              ? copy.emptyNote
              : depth === null
                ? copy.depthAll
                : depth === 0
                  ? copy.depthNone
                  : `${copy.depth} ${(depth * 100).toFixed(0)}%.`}
          </Note>
        </Card>
      ) : null}
    </div>
  );
}
