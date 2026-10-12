"use client";

import { useMemo, useState } from "react";

import { FailureNotice } from "@/components/app/failure-notice";
import { ActionButton, Card, CardTitle, Note, StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { calendarDate, money, percentFromBps } from "@/lib/core/format";
import { priceAtLtv } from "@/lib/core/guard";
import { positionLtvBps } from "@/lib/core/position";
import {
  defaultPolicy,
  policyActions,
  validatePolicy,
  type Policy,
  type PolicyField,
} from "@/lib/core/policy";
import { formatAmount, parseAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { cn } from "@/lib/cn";
import { useGuardAction, useSelectedPosition } from "@/lib/platform/provider";
import type { Outcome } from "@/lib/platform/types";

/**
 * The rule, written by hand.
 *
 * Until now the only way to set a rule was to describe it to the assistant and
 * confirm what it proposed. That is a fine way to discover the rule and a poor
 * way to adjust it: "move the trigger two points down" should be a drag, not a
 * sentence. So the same policy is now a form, and the assistant's proposals land
 * in the same fields.
 *
 * The form is not a second implementation of the rules. Every limit shown here
 * comes from `validatePolicy`, which is the line by line mirror of the program's
 * `PolicyParams::validate`, so the interface refuses a rule for exactly the reason
 * the chain would, before a wallet ever opens.
 *
 * Two facts about the position drive the two numbers people actually think about.
 * The sliders show the price at which the trigger and target would sit, because a
 * person does not hold "72% LTV" in their head; they hold "if SOL goes to $140".
 */

const copy = en.app.rule;

/** Expiry offered as calendar dates rather than durations (PLATFORM.md 2.3). */
const EXPIRY_DAYS = [7, 30, 60, 90] as const;

const PARSE_MESSAGES: Record<string, string> = {
  not_a_number: "That is not an amount.",
  negative: "Amounts are positive.",
  too_precise: `${QUOTE_SYMBOL} has six decimal places, so this is more precision than the token has.`,
};

function daysFromNow(now: number, days: number): number {
  return now + days * 24 * 60 * 60;
}

/** The expiry preset a policy is on, if it is on one. */
function expiryPreset(policy: Policy, now: number): number | null {
  const remaining = policy.expiresAt - now;
  const days = Math.round(remaining / (24 * 60 * 60));
  return EXPIRY_DAYS.includes(days as (typeof EXPIRY_DAYS)[number]) ? days : null;
}

function Field({
  label,
  htmlFor,
  hint,
  problem,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  problem?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[12px] text-ink-dim">
          {label}
        </label>
        {hint ? <span className="num text-[12px] text-ink-faint">{hint}</span> : null}
      </div>
      {children}
      {problem ? <p className="text-[12px] text-state-danger">{problem}</p> : null}
    </div>
  );
}

/**
 * A slider with its value read out beside it. Native `<input type="range">`,
 * because the browser's is keyboard accessible, touch friendly and themed by
 * `accent-color`, and a custom one would be all three only after a lot of work.
 */
function LtvSlider({
  id,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (bps: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={50}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-accent"
      />
      <span className="num w-14 shrink-0 text-right text-[15px] text-ink">
        {percentFromBps(value)}
      </span>
    </div>
  );
}

function Result({ outcome }: { outcome: Outcome | undefined }) {
  if (!outcome) return null;
  if (outcome.ok) return <p className="mt-3 text-[13px] text-state-ok">{copy.saved}</p>;
  return <FailureNotice className="mt-3" failure={outcome.failure} />;
}

export function RuleEditor() {
  const { entry, snapshot, failure } = useSelectedPosition();
  const now = snapshot?.now ?? 0;
  const position = entry?.position ?? null;
  const guard = entry?.guard ?? null;
  const obligation = position?.obligation ?? "";

  // The form starts from the rule on chain when there is one, and from the
  // default otherwise. It re-seeds only when the rule itself changes (a fresh
  // authorization, a save that landed), never on the one second snapshot poll,
  // or a slider would snap back under the user's thumb. The key is the policy's
  // own bytes, so a poll that returns the same rule is not a change.
  const seedKey = guard
    ? `${guard.address}:${JSON.stringify(serialise(guard.policy))}`
    : snapshot
      ? "default"
      : null;
  const [seeded, setSeeded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Policy>(() => defaultPolicy(now));
  const [capText, setCapText] = useState("");
  const [advanced, setAdvanced] = useState(false);

  if (seedKey !== null && seedKey !== seeded) {
    const seed = guard?.policy ?? defaultPolicy(now);
    setDraft(seed);
    setCapText(formatAmount(seed.maxActionAmount, QUOTE_DECIMALS, { maxFractionDigits: 6, group: false }));
    setSeeded(seedKey);
  }

  const capParsed = capText.trim() === "" ? null : parseAmount(capText, QUOTE_DECIMALS);
  const capProblem = capParsed && !capParsed.ok ? (PARSE_MESSAGES[capParsed.reason] ?? null) : null;

  const policy: Policy = useMemo(
    () => ({ ...draft, maxActionAmount: capParsed?.ok ? capParsed.amount : 0n }),
    [draft, capParsed],
  );

  const problems = snapshot
    ? validatePolicy(policy, { now, liquidationLtvBps: position?.liquidationLtvBps })
    : [];
  const problemFor = (field: PolicyField) =>
    problems.find((problem) => problem.field === field)?.message;

  const dirty = guard === null || JSON.stringify(serialise(policy)) !== JSON.stringify(serialise(guard.policy));
  const valid = problems.length === 0 && capProblem === null;

  const save = useGuardAction((source) =>
    guard === null
      ? source.authorize({ obligation, policy })
      : source.updatePolicy({ obligation, policy }),
  );

  if (failure && !snapshot) return <FailureNotice failure={failure} />;
  if (!snapshot || !position) return <Note>Reading your position</Note>;

  const ltv = positionLtvBps(position);
  const price = position.collateralPrice;
  const liquidation = position.liquidationLtvBps;
  const triggerPrice = priceAtLtv(price, ltv, draft.triggerLtvBps);
  const targetPrice = priceAtLtv(price, ltv, draft.targetLtvBps);
  const preset = expiryPreset(draft, now);
  const actions = policyActions(policy);

  const set = <K extends keyof Policy>(key: K, value: Policy[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle>{guard ? copy.editHeading : copy.createHeading}</CardTitle>
        <p className="mt-3 max-w-[68ch] text-[13px] leading-relaxed text-ink-dim">
          {guard ? copy.editLead : copy.createLead}
        </p>

        <div className="mt-6 flex flex-col gap-6">
          <Field
            label={copy.trigger}
            htmlFor="rule-trigger"
            hint={`${copy.atPrice} ${money(triggerPrice)}`}
            problem={problemFor("triggerLtvBps")}
          >
            <LtvSlider
              id="rule-trigger"
              value={draft.triggerLtvBps}
              min={1_000}
              max={Math.max(1_050, liquidation - 50)}
              onChange={(bps) =>
                setDraft((current) => ({
                  ...current,
                  triggerLtvBps: bps,
                  // The target follows the trigger down so the pair stays valid
                  // without the user having to fix a second slider.
                  targetLtvBps: Math.min(current.targetLtvBps, bps - 50),
                }))
              }
            />
            <p className="text-[12px] text-ink-faint">
              {copy.triggerNote
                .replace("{now}", percentFromBps(ltv))
                .replace("{liquidation}", percentFromBps(liquidation))}
            </p>
          </Field>

          <Field
            label={copy.target}
            htmlFor="rule-target"
            hint={`${copy.atPrice} ${money(targetPrice)}`}
            problem={problemFor("targetLtvBps")}
          >
            <LtvSlider
              id="rule-target"
              value={draft.targetLtvBps}
              min={500}
              max={draft.triggerLtvBps - 50}
              onChange={(bps) => set("targetLtvBps", bps)}
            />
            <p className="text-[12px] text-ink-faint">{copy.targetNote}</p>
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label={copy.cap}
              htmlFor="rule-cap"
              problem={capProblem ?? problemFor("maxActionAmount")}
            >
              <div className="flex items-center rounded-panel border border-line bg-canvas focus-within:border-accent">
                <input
                  id="rule-cap"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={capText}
                  onChange={(event) => setCapText(event.target.value)}
                  placeholder="0.00"
                  className="num min-h-11 w-full bg-transparent px-3 text-[14px] text-ink outline-none"
                />
                <span className="num shrink-0 pr-3 text-[12px] text-ink-faint">{QUOTE_SYMBOL}</span>
              </div>

            </Field>

            <Field
              label={copy.expiry}
              htmlFor="rule-expiry"
              hint={calendarDate(draft.expiresAt)}
              problem={problemFor("expiresAt")}
            >
              <div id="rule-expiry" role="group" className="flex flex-wrap gap-2">
                {EXPIRY_DAYS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    aria-pressed={preset === days}
                    onClick={() => set("expiresAt", daysFromNow(now, days))}
                    className={cn(
                      "min-h-9 rounded-panel border px-3 text-[12px] transition-colors duration-300",
                      preset === days
                        ? "border-accent/40 bg-accent-wash text-ink"
                        : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {days} {copy.days}
                  </button>
                ))}
              </div>

            </Field>
          </div>

          <div className="border-t border-line pt-5">
            <button
              type="button"
              onClick={() => setAdvanced((open) => !open)}
              aria-expanded={advanced}
              className="text-[13px] text-ink-dim underline-offset-4 transition-colors duration-300 hover:text-ink hover:underline"
            >
              {advanced ? copy.hideAdvanced : copy.showAdvanced}
            </button>

            {advanced ? (
              <div className="mt-5 grid gap-6 sm:grid-cols-3">
                <Field
                  label={copy.actionsPerWindow}
                  htmlFor="rule-actions"
                  problem={problemFor("maxActionsPerWindow")}
                >
                  <input
                    id="rule-actions"
                    type="number"
                    min={1}
                    max={255}
                    value={draft.maxActionsPerWindow}
                    onChange={(event) => set("maxActionsPerWindow", Number(event.target.value))}
                    className="num min-h-11 rounded-panel border border-line bg-canvas px-3 text-[14px] text-ink outline-none focus:border-accent"
                  />
                </Field>
                <Field
                  label={copy.windowHours}
                  htmlFor="rule-window"
                  problem={problemFor("windowSeconds")}
                >
                  <input
                    id="rule-window"
                    type="number"
                    min={1}
                    value={Math.round(draft.windowSeconds / 3_600)}
                    onChange={(event) => set("windowSeconds", Number(event.target.value) * 3_600)}
                    className="num min-h-11 rounded-panel border border-line bg-canvas px-3 text-[14px] text-ink outline-none focus:border-accent"
                  />
                </Field>
                <Field
                  label={copy.cooldownMinutes}
                  htmlFor="rule-cooldown"
                  problem={problemFor("cooldownSeconds")}
                >
                  <input
                    id="rule-cooldown"
                    type="number"
                    min={1}
                    value={Math.round(draft.cooldownSeconds / 60)}
                    onChange={(event) => set("cooldownSeconds", Number(event.target.value) * 60)}
                    className="num min-h-11 rounded-panel border border-line bg-canvas px-3 text-[14px] text-ink outline-none focus:border-accent"
                  />
                </Field>
                <p className="text-[12px] leading-relaxed text-ink-faint sm:col-span-3">
                  {copy.advancedNote}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
          <ActionButton
            variant="primary"
            busy={save.isPending}
            disabled={!valid || !dirty}
            onClick={() => save.mutate()}
          >
            {guard ? copy.save : copy.grant}
          </ActionButton>
          {!dirty && guard ? <Note>{copy.unchanged}</Note> : null}
          {guard && dirty && valid ? <Note>{copy.willSign}</Note> : null}
        </div>
        {/* "Saved" only while the form still matches what was saved. The moment
            a slider moves, the message would be describing a different rule. */}
        {save.data && (!save.data.ok || !dirty) ? <Result outcome={save.data} /> : null}
      </Card>

      {/* The grant, behind a disclosure. Generated from the policy mask and the
          program's instruction list, so it cannot age into a promise the program
          no longer keeps; collapsed because it is the same six lines every visit. */}
      <details className="group">
        <summary className="cursor-pointer list-none text-[13px] text-ink-dim underline-offset-4 hover:text-ink hover:underline">
          {copy.grantsSummary}
        </summary>
        <div className="mt-4 grid gap-6 border-t border-line pt-4 md:grid-cols-2">
          <ul className="flex flex-col gap-2">
            <li className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">{copy.canHeading}</li>
            {actions.map((action) => (
              <li key={action} className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-dim">
                <span className="mt-1.5 shrink-0"><StatusDot tone="warn" /></span>
                {copy.can[action]}
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2">
            <li className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">{copy.cannotHeading}</li>
            {copy.cannot.map((line: string) => (
              <li key={line} className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-dim">
                <span className="mt-1.5 shrink-0"><StatusDot tone="neutral" /></span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}

/** Policy as plain JSON, so two can be compared for "did anything change". */
function serialise(policy: Policy) {
  return {
    ...policy,
    maxActionAmount: policy.maxActionAmount.toString(),
    scheduleAmount: policy.scheduleAmount.toString(),
  };
}
