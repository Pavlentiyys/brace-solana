"use client";

import { useState } from "react";

import { FailureNotice } from "@/components/app/failure-notice";
import { ActionButton, Card, CardTitle, Note, Row, Rows } from "@/components/app/ui";
import { en } from "@/content/en";
import { percentFromBps } from "@/lib/core/format";
import { positionLtvBps } from "@/lib/core/position";
import { formatAmount, parseAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { useGuardAction, useSelectedPosition } from "@/lib/platform/provider";
import type { Outcome } from "@/lib/platform/types";

/**
 * Paying down the debt now, from the reserve, on the owner's own signature.
 *
 * It sits apart from the rule for a reason worth stating on screen: nothing here is
 * delegated. The agent's trigger, target, cooldown and window do not apply, because
 * none of them are protecting anybody from the owner. What bounds this is the
 * reserve balance and the wallet prompt.
 *
 * "All of it" means the whole reserve rather than the whole debt. Kamino settles a
 * repay at whatever is outstanding, so an over-funded reserve clears the debt and
 * keeps the difference, and saying "all your debt" would be a promise this screen
 * cannot keep when the reserve is smaller than the loan.
 */

const copy = en.app.repayNow;

const PARSE_MESSAGES: Record<string, string> = {
  not_a_number: "That is not an amount.",
  negative: "Amounts are positive.",
  too_precise: `${QUOTE_SYMBOL} has six decimal places, so this is more precision than the token has.`,
};

function Result({ outcome }: { outcome: Outcome | undefined }) {
  if (!outcome) return null;
  if (outcome.ok) return <p className="mt-3 text-[13px] text-state-ok">{copy.done}</p>;
  return <FailureNotice className="mt-3" failure={outcome.failure} />;
}

export function RepayNow() {
  const { entry, snapshot, failure } = useSelectedPosition();
  const [text, setText] = useState("");

  const parsed = text.trim() === "" ? null : parseAmount(text, QUOTE_DECIMALS);
  const amount = parsed?.ok ? parsed.amount : null;
  const problem = parsed && !parsed.ok ? (PARSE_MESSAGES[parsed.reason] ?? null) : null;

  const obligation = entry?.position.obligation ?? "";
  const part = useGuardAction((source) => source.repayNow({ obligation, amount }));
  const all = useGuardAction((source) => source.repayNow({ obligation, amount: null }));

  if (failure && !snapshot) return <FailureNotice failure={failure} />;
  if (!snapshot || !entry) return <Note>Reading your position</Note>;

  const { position, guard } = entry;
  const reserveBalance = snapshot.reserveBalance;
  const tooMuch = amount !== null && amount > reserveBalance;

  return (
    <Card>
      <CardTitle>{copy.heading}</CardTitle>
      <p className="mt-3 max-w-[68ch] text-[13px] leading-relaxed text-ink-dim">{copy.body}</p>

      <Rows>
        <Row
          label={copy.reserve}
          value={`${formatAmount(reserveBalance, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
        />
        <Row
          label={copy.debt}
          value={`${formatAmount(position.debt.amount, position.debt.decimals)} ${position.debt.symbol}`}
        />
        <Row label={copy.ltv} value={percentFromBps(positionLtvBps(position))} />
      </Rows>

      <div className="mt-5 flex flex-col gap-2">
        <label htmlFor="repay-amount" className="text-[11px] text-ink-faint">
          {copy.amount}
        </label>
        <div className="flex items-center rounded-panel border border-line bg-canvas focus-within:border-accent">
          <input
            id="repay-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="0.00"
            className="num min-h-11 w-full bg-transparent px-3 text-[14px] text-ink outline-none"
          />
          <span className="num shrink-0 pr-3 text-[12px] text-ink-faint">{QUOTE_SYMBOL}</span>
        </div>
        {problem ? <p className="text-[12px] text-state-danger">{problem}</p> : null}
        {tooMuch ? <p className="text-[12px] text-state-danger">{copy.overReserve}</p> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionButton
          variant="primary"
          busy={part.isPending}
          disabled={!guard || amount === null || amount <= 0n || tooMuch}
          onClick={() => part.mutate()}
        >
          {copy.repayPart}
        </ActionButton>
        <ActionButton
          busy={all.isPending}
          disabled={!guard || reserveBalance <= 0n}
          onClick={() => all.mutate()}
        >
          {copy.repayAll}
        </ActionButton>
      </div>

      <Note className="mt-3 max-w-[70ch]">{copy.note}</Note>
      {!guard ? <Note className="mt-2">{copy.needsGuard}</Note> : null}

      <Result outcome={part.data} />
      <Result outcome={all.data} />
    </Card>
  );
}
