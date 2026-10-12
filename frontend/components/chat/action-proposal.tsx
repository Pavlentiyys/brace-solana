"use client";

import { useState } from "react";

import { FailureNotice } from "@/components/app/failure-notice";
import { ActionButton, Card, CardTitle, Note, Row, Rows } from "@/components/app/ui";
import { en } from "@/content/en";
import { checkRule, describeAction, type ProposedAction } from "@/lib/chat/actions";
import { percentFromBps } from "@/lib/core/format";
import { formatAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { explorerUrl } from "@/lib/platform/config";
import { useGuardAction, usePlatform, useSelectedPosition } from "@/lib/platform/provider";
import type { Failure, Outcome } from "@/lib/platform/types";

/**
 * What the agent proposed, and the one place it can become real.
 *
 * The model turns a sentence into a typed proposal. Everything after that is the
 * app's: the rule is checked against `PolicyParams::validate` mirrored in
 * `lib/core/policy.ts`, rendered field by field, and only signed when the user
 * presses confirm and approves in their wallet.
 *
 * So a model that misreads "50%" as "5%" produces a card saying 5%, not a rule.
 * Nothing here trusts the model with anything except the suggestion.
 */
export function ActionProposal({ action }: { action: ProposedAction }) {
  const { config, source } = usePlatform();
  const { entry, snapshot } = useSelectedPosition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const obligation = entry?.position.obligation ?? "";
  const liquidationLtvBps = entry?.position.liquidationLtvBps;

  /*
   * The clock comes from the snapshot, never from `Date.now()` here.
   *
   * Reading the wall clock during render is impure, and the expiry it feeds is part
   * of what the user is about to sign — it should come from the same read as the
   * position it is validated against, not from whenever React happened to re-render.
   * Until the first read lands there is nothing to check the rule against, so the
   * card describes the proposal and waits rather than validating against a guess.
   */
  const now = snapshot?.now ?? null;
  const checked =
    action.kind === "set_rule" && now !== null
      ? checkRule(action, { now, liquidationLtvBps })
      : null;
  const problems = checked?.problems ?? [];
  const waiting = action.kind === "set_rule" && checked === null;

  const run = useGuardAction(async (guardSource) => {
    switch (action.kind) {
      case "set_rule":
        // The same proposal means two different instructions depending on
        // whether a guard exists. A second `init_guard` on an occupied PDA fails
        // inside the wallet with nothing on screen to explain it.
        return entry?.guard
          ? guardSource.updatePolicy({ obligation, policy: checked!.policy })
          : guardSource.authorize({ obligation, policy: checked!.policy });
      case "pause":
        return guardSource.setPaused({ obligation, paused: true });
      case "resume":
        return guardSource.setPaused({ obligation, paused: false });
      case "revoke":
        return guardSource.revoke({ obligation });
      case "deposit":
        return guardSource.deposit({
          obligation,
          amount: BigInt(Math.round(action.tokens * 10 ** QUOTE_DECIMALS)),
        });
      case "withdraw":
        return guardSource.withdraw({
          obligation,
          amount:
            action.tokens === null
              ? null
              : BigInt(Math.round(action.tokens * 10 ** QUOTE_DECIMALS)),
        });
    }
  });

  const blocked = problems.length > 0 || obligation === "" || !source.canWrite || waiting;
  const signature = outcome?.ok ? outcome.signature : null;
  const failure: Failure | null = outcome && !outcome.ok ? outcome.failure : null;

  return (
    <Card>
      <CardTitle>{en.app.proposal.heading}</CardTitle>
      <p className="mt-3 max-w-[64ch] text-[13px] leading-relaxed text-ink">
        {describeAction(action, QUOTE_SYMBOL)}
      </p>

      {checked ? (
        <Rows>
          <Row label="Acts at" value={percentFromBps(checked.policy.triggerLtvBps)} />
          <Row label="Restores to" value={percentFromBps(checked.policy.targetLtvBps)} />
          <Row
            label="Most per action"
            value={`${formatAmount(checked.policy.maxActionAmount, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
          />
          <Row
            label="Rate limit"
            value={`${checked.policy.maxActionsPerWindow} per ${Math.round(checked.policy.windowSeconds / 3_600)}h, ${checked.policy.cooldownSeconds}s apart`}
          />
          <Row
            label="Expires"
            value={new Date(checked.policy.expiresAt * 1_000).toISOString().slice(0, 10)}
          />
        </Rows>
      ) : null}

      {problems.length > 0 ? (
        <div className="mt-4 rounded-panel border border-line-strong bg-raised p-3">
          <p className="text-[12px] text-state-danger">{en.app.proposal.rejected}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {problems.map((problem) => (
              <li key={`${problem.field}-${problem.message}`} className="text-[12px] text-ink-dim">
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <ActionButton
          variant="primary"
          busy={run.isPending}
          disabled={blocked || signature !== null}
          onClick={() => run.mutate(undefined, { onSuccess: setOutcome })}
        >
          {signature ? en.app.proposal.done : en.app.proposal.confirm}
        </ActionButton>
        <Note>
          {obligation === ""
            ? en.app.proposal.needsPosition
            : !source.canWrite
              ? en.app.proposal.cannotSign
              : waiting
                ? en.app.proposal.waiting
                : en.app.proposal.note}
        </Note>
      </div>

      {signature ? (
        <a
          href={explorerUrl(config, signature) ?? "#"}
          rel="noreferrer noopener"
          target="_blank"
          className="num mt-3 inline-block text-[12px] text-accent underline-offset-4 hover:underline"
        >
          {signature.slice(0, 24)}…
        </a>
      ) : null}

      {failure ? <FailureNotice className="mt-4" failure={failure} /> : null}
    </Card>
  );
}
