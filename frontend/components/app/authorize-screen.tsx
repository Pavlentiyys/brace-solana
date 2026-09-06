"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { FailureNotice } from "@/components/app/failure-notice";
import { ActionButton, Card, CardTitle, Note, PageHeading, Row, Rows, StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { calendarDate, percentFromBps } from "@/lib/core/format";
import { authorityIsLive, authorityStatus } from "@/lib/core/guard";
import { durationLabel } from "@/lib/core/liveness";
import { defaultPolicy, policyActions, validatePolicy } from "@/lib/core/policy";
import { DISCRIMINATORS, MAX_DELEGATION_SECONDS } from "@/lib/core/program";
import { formatAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { programExplorerUrl } from "@/lib/platform/config";
import { useGuardAction, usePlatform, useSelectedPosition } from "@/lib/platform/provider";

/**
 * Screen 2.3, the one screen the chat cannot replace, and the one that decides
 * whether the user trusts any of this.
 *
 * Two rules from PLATFORM.md 2.3 shape it.
 *
 * The capability lists are generated, not written. The "can" list comes from the
 * policy's action mask and the "cannot" list is anchored by the instruction list
 * below it, which is the program's own. A hand-written promise ages into a lie the
 * first time the program changes; a generated list goes stale loudly.
 *
 * The end of the authorization is a DATE. "Ends on 19 November 2026" is checkable
 * against a calendar. "90 days" is homework.
 *
 * There is no form here. The rule is set in conversation (3.3), and a second place
 * to set it would become the place it drifts from.
 */

const copy = en.app.authorize;

export function AuthorizeScreen() {
  const router = useRouter();
  const { config } = usePlatform();
  const { entry, snapshot, failure } = useSelectedPosition();

  // The clock comes from the source, never from `Date.now()` during a render. The
  // expiry date on this screen is part of what the user is agreeing to, and a value
  // that differs between the server render and the client one is the last place to
  // discover that.
  const now = snapshot?.now ?? 0;
  // The guard is read from the selected position. Keep its policy as the source of
  // truth whenever authorization already exists; otherwise this is a new
  // authorization preview and the chat's standard starting policy is appropriate.
  const existing = entry?.guard ?? null;
  const policy = useMemo(
    () => existing?.policy ?? defaultPolicy(now),
    [existing, now],
  );

  const problems = snapshot
    ? validatePolicy(policy, { now, liquidationLtvBps: entry?.position.liquidationLtvBps })
    : [];

  const authorize = useGuardAction((source) =>
    source.authorize({ obligation: entry?.position.obligation ?? "", policy }),
  );
  const migrate = useGuardAction((source) =>
    source.migrateGuard({ obligation: entry?.position.obligation ?? "" }),
  );

  const explorer = programExplorerUrl(config);
  const actions = policyActions(policy);

  if (failure && !snapshot) return <FailureNotice failure={failure} />;
  if (!snapshot) return <Note>Reading your position</Note>;

  // An authorization that exists but predates the current program. It is not
  // missing, so offering to create one would fail at the wallet; it needs growing.
  const stranded = entry?.guardNeedsMigration === true;

  return (
    <div className="flex max-w-[860px] flex-col gap-8">
      <PageHeading title={copy.heading} lead={copy.lead} />

      {stranded ? (
        <Card>
          <CardTitle>
            <StatusDot tone="warn" /> {copy.strandedHeading}
          </CardTitle>
          <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-ink-dim">
            {copy.strandedBody}
          </p>
          <ActionButton
            className="mt-4"
            variant="primary"
            busy={migrate.isPending}
            onClick={() => migrate.mutate()}
          >
            {copy.strandedCta}
          </ActionButton>
          <Note className="mt-3 max-w-[70ch]">{copy.strandedNote}</Note>
          {migrate.data && !migrate.data.ok ? (
            <FailureNotice className="mt-3" failure={migrate.data.failure} />
          ) : null}
          {migrate.data?.ok ? (
            <p className="mt-3 text-[13px] text-state-ok">{copy.strandedDone}</p>
          ) : null}
        </Card>
      ) : null}

      {existing ? (
        <Card>
          <CardTitle>
            <StatusDot tone={authorityIsLive(existing, now) ? "ok" : "warn"} />{" "}
            {copy.existingHeading}
          </CardTitle>
          <Note className="mt-2 max-w-[70ch]">{copy.existingBody}</Note>
          <Rows>
            <Row label={copy.existingStatus} value={authorityStatus(existing, now)} />
            <Row
              label={copy.trigger}
              value={`${percentFromBps(existing.policy.triggerLtvBps)} LTV`}
            />
            <Row
              label={copy.target}
              value={`${percentFromBps(existing.policy.targetLtvBps)} LTV`}
            />
            <Row label={copy.existingExpiry} value={calendarDate(existing.policy.expiresAt)} />
          </Rows>
          <Link
            href="/chat"
            className="mt-4 inline-block text-[13px] text-accent underline-offset-4 hover:underline"
          >
            {copy.existingCta}
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{copy.canHeading}</CardTitle>
          <ul className="mt-4 flex flex-col gap-2.5">
            {actions.map((action) => (
              <li key={action} className="flex items-start gap-2.5 text-[14px] text-ink">
                <span className="mt-2">
                  <StatusDot tone="warn" />
                </span>
                {copy.can[action]}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>{copy.cannotHeading}</CardTitle>
          <ul className="mt-4 flex flex-col gap-2.5">
            {copy.cannot.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[14px] text-ink-dim">
                <span className="mt-2">
                  <StatusDot tone="neutral" />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitle>{copy.verifyHeading}</CardTitle>
        <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-ink-dim">
          {copy.verifyBody.replace("{count}", String(Object.keys(DISCRIMINATORS).length))}
        </p>
        <p className="mt-4 text-[12px] uppercase tracking-[0.08em] text-ink-faint">
          {copy.instructionsLabel}
        </p>
        <ul className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink">
          {Object.keys(DISCRIMINATORS).map((instruction) => (
            <li key={instruction}>{instruction}</li>
          ))}
        </ul>
        {explorer ? (
          <a
            href={explorer}
            rel="noreferrer noopener"
            target="_blank"
            className="mt-4 inline-block text-[13px] text-accent underline-offset-4 hover:underline"
          >
            Program in the explorer
          </a>
        ) : (
          <Note className="mt-4 max-w-[70ch]">{copy.notDeployed}</Note>
        )}
      </Card>

      <Card>
        <CardTitle>{copy.limitsHeading}</CardTitle>
        <Note className="mt-2">{copy.ruleFallback}</Note>
        <Rows>
          <Row label={copy.trigger} value={`${percentFromBps(policy.triggerLtvBps)} LTV`} />
          <Row label={copy.target} value={`${percentFromBps(policy.targetLtvBps)} LTV`} />
          <Row
            label={copy.cap}
            value={`${formatAmount(policy.maxActionAmount, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
          />
          <Row
            label={copy.rate}
            value={`${policy.maxActionsPerWindow} per ${durationLabel(policy.windowSeconds)}`}
          />
          <Row label={copy.cooldown} value={durationLabel(policy.cooldownSeconds)} />
          <Row label={copy.expiry} value={calendarDate(policy.expiresAt)} />
        </Rows>
        <Note className="mt-3 max-w-[70ch]">{copy.expiryNote}</Note>
        <Note className="mt-1 max-w-[70ch]">
          {copy.programCeiling} The longest this one could be is{" "}
          {calendarDate(now + MAX_DELEGATION_SECONDS)}.
        </Note>
      </Card>

      {problems.length > 0 ? (
        <FailureNotice
          failure={{ kind: "invalid_policy", messages: problems.map((problem) => problem.message) }}
        />
      ) : null}

      {!existing && !stranded ? (
        <div className="flex flex-wrap items-center gap-4">
          <ActionButton
            variant="primary"
            busy={authorize.isPending}
            disabled={!entry || problems.length > 0}
            onClick={() =>
              authorize.mutate(undefined, {
                onSuccess: (outcome) => {
                  if (outcome.ok) router.push("/chat/reserve");
                },
              })
            }
          >
            {authorize.isPending ? copy.submitting : copy.submit}
          </ActionButton>
          {authorize.data?.ok ? <span className="text-[13px] text-state-ok">{copy.done}</span> : null}
        </div>
      ) : null}

      {authorize.data && !authorize.data.ok ? (
        <FailureNotice failure={authorize.data.failure} />
      ) : null}
    </div>
  );
}
