"use client";

import { useState } from "react";

import { FailureNotice } from "@/components/app/failure-notice";
import { ActionButton, Card, CardTitle, Note, Row, Rows } from "@/components/app/ui";
import { en } from "@/content/en";
import { calendarDate } from "@/lib/core/format";
import { durationLabel } from "@/lib/core/liveness";
import { hasSchedule, nextScheduledAt, SCHEDULE_PRESETS, type SchedulePreset } from "@/lib/core/policy";
import { formatAmount, parseAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { cn } from "@/lib/cn";
import { useGuardAction, useSelectedPosition } from "@/lib/platform/provider";
import type { Outcome } from "@/lib/platform/types";

/**
 * The standing payment: repay this much, this often, whatever the price is doing.
 *
 * This is the one grant that lets the agent spend the reserve on a position nobody
 * is about to liquidate, so the screen says so in the first sentence rather than
 * describing it as a setting. Everything else in the rule is a limit on the agent;
 * this is a permission, and the difference has to be visible before it is signed.
 *
 * The two numbers move together because the program refuses a policy that carries
 * either half alone. There is no way from here to leave an interval behind with the
 * grant switched off, which is what makes "turn it off" a complete answer.
 */

const copy = en.app.schedule;

const PRESET_ORDER: SchedulePreset[] = ["daily", "weekly", "fortnightly", "monthly"];

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

export function ScheduleScreen() {
  const { entry, snapshot, failure } = useSelectedPosition();
  const guard = entry?.guard ?? null;

  const [preset, setPreset] = useState<SchedulePreset>("weekly");
  const [text, setText] = useState("");

  const parsed = text.trim() === "" ? null : parseAmount(text, QUOTE_DECIMALS);
  const amount = parsed?.ok ? parsed.amount : null;
  const problem = parsed && !parsed.ok ? (PARSE_MESSAGES[parsed.reason] ?? null) : null;

  const obligation = entry?.position.obligation ?? "";
  const save = useGuardAction((source) =>
    source.setSchedule({
      obligation,
      schedule: { everySeconds: SCHEDULE_PRESETS[preset], amount: amount ?? 0n },
    }),
  );
  const clear = useGuardAction((source) => source.setSchedule({ obligation, schedule: null }));

  if (failure && !snapshot) return <FailureNotice failure={failure} />;
  if (!snapshot) return <Note>Reading your position</Note>;

  const running = guard !== null && hasSchedule(guard.policy);
  const due = guard ? nextScheduledAt(guard) : null;

  return (
    <Card>
      <CardTitle>{copy.heading}</CardTitle>
      <p className="mt-3 max-w-[68ch] text-[13px] leading-relaxed text-ink-dim">{copy.body}</p>

      {running && guard ? (
        <Rows>
          <Row
            label={copy.currentEvery}
            value={durationLabel(guard.policy.scheduleSeconds)}
          />
          <Row
            label={copy.currentAmount}
            value={`${formatAmount(guard.policy.scheduleAmount, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
          />
          {due !== null ? <Row label={copy.nextDue} value={calendarDate(due)} /> : null}
        </Rows>
      ) : (
        <Note className="mt-4">{copy.none}</Note>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <span className="text-[11px] text-ink-faint">{copy.every}</span>
        <div className="flex flex-wrap gap-2">
          {PRESET_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPreset(option)}
              aria-pressed={preset === option}
              className={cn(
                "min-h-9 rounded-panel border px-3 text-[12px] transition-colors duration-300",
                preset === option
                  ? "border-accent/40 bg-accent-wash text-ink"
                  : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
              )}
            >
              {copy.presets[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor="schedule-amount" className="text-[11px] text-ink-faint">
          {copy.amount}
        </label>
        <div className="flex items-center rounded-panel border border-line bg-canvas focus-within:border-accent">
          <input
            id="schedule-amount"
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
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionButton
          variant="primary"
          busy={save.isPending}
          disabled={!guard || amount === null || amount <= 0n}
          onClick={() => save.mutate()}
        >
          {running ? copy.update : copy.start}
        </ActionButton>
        <ActionButton busy={clear.isPending} disabled={!running} onClick={() => clear.mutate()}>
          {copy.stop}
        </ActionButton>
      </div>

      <Note className="mt-3 max-w-[70ch]">{copy.note}</Note>
      {!guard ? <Note className="mt-2">{copy.needsGuard}</Note> : null}

      <Result outcome={save.data} />
      <Result outcome={clear.data} />
    </Card>
  );
}
