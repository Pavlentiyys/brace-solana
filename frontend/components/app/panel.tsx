"use client";

import Link from "next/link";

import { FailureNotice } from "@/components/app/failure-notice";
import { LtvReadout } from "@/components/app/ltv-readout";
import { ActionButton, Card, CardTitle, Note, PageHeading, Row, Rows, StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { calendarDate, percentFromBps } from "@/lib/core/format";
import {
  agentReadiness,
  authorityStatus,
  cooldownRemaining,
  expiryIsNear,
  secondsUntilExpiry,
  windowUsage,
  type Guard,
} from "@/lib/core/guard";
import { agoLabel, durationLabel, priceIsStale, watcherLiveness } from "@/lib/core/liveness";
import { positionLtvBps } from "@/lib/core/position";
import { firingsLeft, minimumForOneAction } from "@/lib/core/reserve";
import { nextScheduledAt } from "@/lib/core/policy";
import { formatAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { useGuardAction, useSelectedPosition } from "@/lib/platform/provider";
import type { Outcome } from "@/lib/platform/types";
import { PositionList } from "@/components/app/connect";
import { DemoControls } from "@/components/app/demo-controls";

/**
 * Screen 2.5. The panel, designed from the narrow screen out.
 *
 * Order is fixed by what a person opens this for: the reading, whether anything is
 * still watching it, whether the agent would act, and then the state behind that.
 * Pause, revoke and withdraw are reachable from every one of those states without
 * scrolling past an explanation, because section 7 requires the exit to be one
 * click and an exit you have to hunt for is not one click.
 *
 * The rule itself is read only here. It is set in conversation (3.3) and this screen
 * says so rather than growing a form that would become a second way to set it.
 */

const copy = en.app.panel;

function ActionFailure({ outcome }: { outcome: Outcome | undefined }) {
  if (!outcome || outcome.ok) return null;
  return <FailureNotice className="mt-4" failure={outcome.failure} />;
}

function LivenessLine({ lastCheckAt, now }: { lastCheckAt: number | null; now: number }) {
  const { state, secondsAgo } = watcherLiveness(lastCheckAt, now);
  const tone = state === "fresh" ? "ok" : state === "lagging" ? "warn" : state === "stalled" ? "danger" : "neutral";

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="flex items-center gap-2">
        <StatusDot tone={tone} />
        <span className="text-[13px] text-ink-dim">{copy.liveness.label}{" "}</span>
        <span className="num text-[13px] text-ink">{agoLabel(secondsAgo)}</span>
      </span>
      <span
        className={
          state === "stalled"
            ? "text-[12px] text-state-danger"
            : state === "lagging"
              ? "text-[12px] text-state-warn"
              : "text-[12px] text-ink-faint"
        }
      >
        {copy.liveness[state]}
      </span>
    </div>
  );
}

function AgentCard({
  guard,
  now,
  ltvBps,
  reserveBalance,
}: {
  guard: Guard;
  now: number;
  ltvBps: number;
  reserveBalance: bigint;
}) {
  const readiness = agentReadiness(guard, { now, ltvBps, reserveBalance });
  const tone =
    readiness.state === "armed" ? "warn" : readiness.state === "watching" ? "ok" : "danger";
  const label =
    readiness.state === "armed"
      ? copy.agent.armed
      : readiness.state === "watching"
        ? copy.agent.watching
        : copy.agent.wouldNotAct;

  return (
    <Card>
      <CardTitle>{copy.agent.label}</CardTitle>
      <p className="mt-3 flex items-center gap-2">
        <StatusDot tone={tone} />
        <span className="text-[15px] text-ink">{label}</span>
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {readiness.blockers.map((blocker) => (
          <li key={blocker} className="text-[12px] text-ink-dim">
            {copy.agent.blockers[blocker]}
          </li>
        ))}
        {readiness.blockers.length === 0 ? (
          <li className="text-[12px] text-ink-dim">
            LTV is at or above your trigger and nothing is holding the agent back.
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

function ReserveCard({
  guard,
  reserveBalance,
  perAction,
}: {
  guard: Guard;
  reserveBalance: bigint;
  perAction: bigint;
}) {
  const firings = firingsLeft(reserveBalance, perAction);

  return (
    <Card>
      <CardTitle>{copy.reserve.label}</CardTitle>
      <p className="num mt-3 text-2xl text-ink">
        {formatAmount(reserveBalance, QUOTE_DECIMALS)}{" "}
        <span className="text-[13px] text-ink-faint">{QUOTE_SYMBOL}</span>
      </p>
      {reserveBalance <= 0n ? (
        <p className="mt-2 text-[12px] text-state-danger">{copy.reserve.empty}</p>
      ) : (
        <p className="mt-2 text-[12px] text-ink-dim">
          <span className="num text-ink">{firings}</span>{" "}
          {firings === 1 ? copy.reserve.firingsOne : copy.reserve.firings}
        </p>
      )}
      <Note className="mt-3">
        One firing of your rule costs about {formatAmount(perAction, QUOTE_DECIMALS)} {QUOTE_SYMBOL},
        measured at your {percentFromBps(guard.policy.triggerLtvBps)} trigger.
      </Note>
      <Link
        href="/chat/reserve"
        className="mt-4 inline-block text-[13px] text-accent underline-offset-4 hover:underline"
      >
        {copy.reserve.manage}
      </Link>
    </Card>
  );
}

function AuthorityCard({ guard, now }: { guard: Guard; now: number }) {
  const status = authorityStatus(guard, now);
  const usage = windowUsage(guard, now);
  const cooldown = cooldownRemaining(guard, now);
  const left = secondsUntilExpiry(guard, now);
  const schedule = nextScheduledAt(guard);

  return (
    <Card>
      <CardTitle>{copy.authority.label}</CardTitle>

      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-[15px] text-ink">{copy.authority.expiresOn}</span>
        <span className="num text-[15px] text-ink">{calendarDate(guard.policy.expiresAt)}</span>
      </p>
      <p className="num mt-1 text-[12px] text-ink-faint">
        {durationLabel(left)} {left > 0 ? copy.authority.left : ""}
      </p>

      {status === "revoked" ? (
        <p className="mt-3 text-[12px] text-state-danger">{copy.authority.revoked}</p>
      ) : status === "expired" ? (
        <p className="mt-3 text-[12px] text-state-danger">{copy.authority.expired}</p>
      ) : status === "paused" ? (
        <p className="mt-3 text-[12px] text-state-warn">{copy.authority.paused}</p>
      ) : expiryIsNear(guard, now) ? (
        <p className="mt-3 text-[12px] text-state-warn">{copy.authority.nearExpiry}</p>
      ) : null}

      <Rows>
        <Row
          label={copy.authority.window}
          value={`${usage.used} / ${usage.limit}`}
          hint={`${copy.authority.windowResets} ${durationLabel(Math.max(0, usage.resetsAt - now))}`}
        />
        <Row
          label={copy.authority.cooldown}
          value={cooldown > 0 ? durationLabel(cooldown) : copy.authority.ready}
        />
        {/* Only when there is one. A row reading "no schedule" on every panel would
            be four words of chrome describing the absence of a feature. */}
        {schedule !== null ? (
          <Row
            label={copy.authority.nextPayment}
            value={`${formatAmount(guard.policy.scheduleAmount, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
            hint={`${copy.authority.everyLabel} ${durationLabel(guard.policy.scheduleSeconds)}, ${copy.authority.nextIn} ${durationLabel(Math.max(0, schedule - now))}`}
          />
        ) : null}
        <Row label="Actions taken" value={guard.totalActions} />
        <Row
          label="Total repaid"
          value={`${formatAmount(guard.totalRepaid, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`}
        />
      </Rows>
    </Card>
  );
}

function RuleCard({ guard }: { guard: Guard }) {
  const { policy } = guard;
  const sentence = copy.rule.sentence
    .replace("{trigger}", percentFromBps(policy.triggerLtvBps))
    .replace("{target}", percentFromBps(policy.targetLtvBps))
    .replace("{cap}", `${formatAmount(policy.maxActionAmount, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`)
    .replace("{count}", String(policy.maxActionsPerWindow))
    .replace("{window}", durationLabel(policy.windowSeconds));

  return (
    <Card className="md:col-span-2">
      <CardTitle>{copy.rule.label}</CardTitle>
      <p className="mt-3 max-w-[70ch] text-[14px] leading-relaxed text-ink">{sentence}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <span className="text-[13px] text-ink-faint">{copy.rule.changeInChat}</span>
        <Note>{copy.rule.changeNote}</Note>
      </div>
    </Card>
  );
}

function Controls({ guard, obligation, now }: { guard: Guard; obligation: string; now: number }) {
  const paused = guard.paused;
  const status = authorityStatus(guard, now);

  const pause = useGuardAction((source) => source.setPaused({ obligation, paused: !paused }));
  const revoke = useGuardAction((source) => source.revoke({ obligation }));
  const withdraw = useGuardAction((source) => source.withdraw({ obligation, amount: null }));

  return (
    <Card>
      <CardTitle>Controls</CardTitle>
      {/* One per row, not three across.
          `ActionButton` sets `whitespace-nowrap`, so in a grid cell narrower than
          its label the text ran out of the button and over its neighbour. These
          three labels are sentences rather than verbs, and the panel is often
          rendered inside a chat message at reading width, so there is no column
          count that fits them side by side at every size.

          `items-start` keeps each button the width of its own label instead of
          stretching all three to the card, which would read as a menu. */}
      <div className="mt-4 flex flex-col items-start gap-2.5">
        <ActionButton
          onClick={() => pause.mutate()}
          busy={pause.isPending}
          disabled={status === "revoked" || status === "expired"}
        >
          {paused ? copy.controls.resume : copy.controls.pause}
        </ActionButton>
        <ActionButton onClick={() => withdraw.mutate()} busy={withdraw.isPending}>
          {copy.controls.withdraw}
        </ActionButton>
        <ActionButton
          onClick={() => revoke.mutate()}
          busy={revoke.isPending}
          disabled={status === "revoked"}
        >
          {copy.controls.revoke}
        </ActionButton>
      </div>
      <Note className="mt-3 max-w-[70ch]">{copy.controls.revokeNote}</Note>

      <ActionFailure outcome={pause.data} />
      <ActionFailure outcome={withdraw.data} />
      <ActionFailure outcome={revoke.data} />
    </Card>
  );
}

export function Panel() {
  const { entry, snapshot, failure, isStale } = useSelectedPosition();

  if (failure && !snapshot) return <FailureNotice failure={failure} />;
  if (!snapshot) return <Note>Reading your position</Note>;

  if (!entry) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeading title={en.app.discovery.heading} />
        <PositionList />
      </div>
    );
  }

  const { position, guard } = entry;
  const ltvBps = positionLtvBps(position);
  const now = snapshot.now;

  return (
    <div className="flex flex-col gap-8">
      {/* A dropped request keeps the last numbers on screen and says they are the
          last numbers. Blanking the panel would read as "the position is gone". */}
      {isStale && failure ? <FailureNotice failure={failure} /> : null}
      {priceIsStale(position.priceUpdatedAt, now) ? (
        <FailureNotice failure={{ kind: "price_stale", publishedAt: position.priceUpdatedAt }} />
      ) : null}

      <LtvReadout
        ltvBps={ltvBps}
        triggerLtvBps={guard?.policy.triggerLtvBps ?? 0}
        liquidationLtvBps={position.liquidationLtvBps}
        price={position.collateralPrice}
      />

      <LivenessLine lastCheckAt={snapshot.watcherLastCheckAt} now={now} />

      {guard === null ? (
        <Card>
          <p className="text-[15px] text-ink">{copy.noGuardHeading}</p>
          <p className="mt-3 max-w-[64ch] text-[13px] leading-relaxed text-ink-dim">
            {copy.noGuardBody}
          </p>
          <Link
            href="/chat/authorize"
            className="mt-5 inline-flex min-h-11 items-center rounded-panel bg-accent px-5 text-[14px] font-medium text-canvas transition-colors duration-300 hover:bg-accent-deep"
          >
            {en.app.discovery.authorize}
          </Link>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <AgentCard
              guard={guard}
              now={now}
              ltvBps={ltvBps}
              reserveBalance={snapshot.reserveBalance}
            />
            <ReserveCard
              guard={guard}
              reserveBalance={snapshot.reserveBalance}
              perAction={minimumForOneAction(position, guard.policy)}
            />
            <AuthorityCard guard={guard} now={now} />
            <Controls guard={guard} obligation={position.obligation} now={now} />
            <RuleCard guard={guard} />
          </div>
        </>
      )}

      <DemoControls />
    </div>
  );
}
