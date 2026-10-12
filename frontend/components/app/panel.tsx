"use client";

import Link from "next/link";

import { FailureNotice } from "@/components/app/failure-notice";
import { LtvReadout } from "@/components/app/ltv-readout";
import { ActionButton, Note, PageHeading, StatusDot } from "@/components/app/ui";
import { cn } from "@/lib/cn";
import { en } from "@/content/en";
import { calendarDateShort, percentFromBps } from "@/lib/core/format";
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
 * The rule itself is read only here. It has its own page, and a sentence plus a
 * link is enough on the overview.
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

/** One cell of the metric strip: a label, a number, one line under it. */
function Stat({
  label,
  value,
  unit,
  tone,
  hint,
  action,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "ok" | "warn" | "danger";
  hint?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-4 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">{label}</span>
      <span className="flex items-baseline gap-2">
        {tone ? <StatusDot tone={tone} /> : null}
        <span className="num truncate text-[17px] text-ink">{value}</span>
        {unit ? <span className="text-[12px] text-ink-faint">{unit}</span> : null}
      </span>
      {hint ? (
        <span
          className={cn(
            "text-[12px] leading-snug",
            tone === "danger" ? "text-state-danger" : tone === "warn" ? "text-state-warn" : "text-ink-dim",
          )}
        >
          {hint}
        </span>
      ) : null}
      {action ? (
        <Link href={action.href} className="mt-1 text-[12px] text-accent underline-offset-4 hover:underline">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The state behind the reading, as a strip rather than four cards.
 *
 * A card promises that what is inside it is a thing of its own. These four are
 * one thing, the guard, seen from four sides, and the borders were only
 * spending space. Hairlines between cells and a single line under each number
 * say the same at a third of the height.
 */
function StatusStrip({
  guard,
  now,
  ltvBps,
  reserveBalance,
  perAction,
}: {
  guard: Guard;
  now: number;
  ltvBps: number;
  reserveBalance: bigint;
  perAction: bigint;
}) {
  const readiness = agentReadiness(guard, { now, ltvBps, reserveBalance });
  const status = authorityStatus(guard, now);
  const usage = windowUsage(guard, now);
  const cooldown = cooldownRemaining(guard, now);
  const left = secondsUntilExpiry(guard, now);
  const firings = firingsLeft(reserveBalance, perAction);
  const schedule = nextScheduledAt(guard);

  const agentTone =
    readiness.state === "armed" ? "warn" : readiness.state === "watching" ? "ok" : "danger";
  const agentLabel =
    readiness.state === "armed"
      ? copy.agent.armed
      : readiness.state === "watching"
        ? copy.agent.watching
        : copy.agent.wouldNotAct;
  const agentHint = readiness.blockers[0] ? copy.agent.blockers[readiness.blockers[0]] : undefined;

  const authorityHint =
    status === "revoked"
      ? copy.authority.revoked
      : status === "expired"
        ? copy.authority.expired
        : status === "paused"
          ? copy.authority.paused
          : `${durationLabel(left)} ${copy.authority.left}`;
  const authorityTone =
    status === "active" ? (expiryIsNear(guard, now) ? "warn" : undefined) : status === "paused" ? "warn" : "danger";

  const budget =
    cooldown > 0
      ? `${copy.authority.cooldown} ${durationLabel(cooldown)}`
      : schedule !== null
        ? `${copy.authority.nextPayment} ${durationLabel(Math.max(0, schedule - now))}`
        : copy.authority.ready;

  return (
    <div className="grid grid-cols-1 divide-y divide-line border-y border-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
      <Stat label={copy.agent.label} value={agentLabel} tone={agentTone} hint={agentHint} />
      <Stat
        label={copy.reserve.label}
        value={formatAmount(reserveBalance, QUOTE_DECIMALS)}
        unit={QUOTE_SYMBOL}
        tone={reserveBalance <= 0n ? "danger" : undefined}
        hint={
          reserveBalance <= 0n
            ? copy.reserve.emptyShort
            : `${firings} ${firings === 1 ? copy.reserve.firingsOne : copy.reserve.firings}`
        }
        action={{ href: "/app/reserve", label: copy.reserve.manage }}
      />
      <Stat
        label={copy.authority.label}
        value={calendarDateShort(guard.policy.expiresAt)}
        tone={authorityTone}
        hint={authorityHint}
      />
      <Stat
        label={copy.authority.window}
        value={`${usage.used} / ${usage.limit}`}
        hint={budget}
      />
    </div>
  );
}

function RuleLine({ guard }: { guard: Guard }) {
  const { policy } = guard;
  const sentence = copy.rule.sentence
    .replace("{trigger}", percentFromBps(policy.triggerLtvBps))
    .replace("{target}", percentFromBps(policy.targetLtvBps))
    .replace("{cap}", `${formatAmount(policy.maxActionAmount, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`)
    .replace("{count}", String(policy.maxActionsPerWindow))
    .replace("{window}", durationLabel(policy.windowSeconds));

  return (
    <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink-dim">
      {sentence}{" "}
      <Link href="/app/rule" className="text-accent underline-offset-4 hover:underline">
        {copy.rule.edit}
      </Link>
    </p>
  );
}

function Controls({ guard, obligation, now }: { guard: Guard; obligation: string; now: number }) {
  const paused = guard.paused;
  const status = authorityStatus(guard, now);

  const pause = useGuardAction((source) => source.setPaused({ obligation, paused: !paused }));
  const revoke = useGuardAction((source) => source.revoke({ obligation }));
  const withdraw = useGuardAction((source) => source.withdraw({ obligation, amount: null }));

  return (
    <div>
      {/* `flex-wrap`, not a grid: a grid cell is allowed to be narrower than
          its content and these labels are sentences, so three across in a
          grid ran the text out of one button and over the next. A wrapping
          row gives each button its own width and drops to a new line instead. */}
      <div className="flex flex-wrap gap-2.5">
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
      <ActionFailure outcome={pause.data} />
      <ActionFailure outcome={withdraw.data} />
      <ActionFailure outcome={revoke.data} />
    </div>
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
    <div className="flex flex-col gap-6">
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
        <div className="flex flex-wrap items-center gap-4 border-y border-line py-4">
          <p className="text-[13px] text-ink-dim">{copy.noGuardHeading}</p>
          <Link
            href="/app/rule"
            className="inline-flex min-h-11 items-center rounded-panel bg-accent px-5 text-[14px] font-medium text-canvas transition-colors duration-300 hover:bg-accent-deep"
          >
            {en.app.discovery.authorize}
          </Link>
        </div>
      ) : (
        <>
          <StatusStrip
            guard={guard}
            now={now}
            ltvBps={ltvBps}
            reserveBalance={snapshot.reserveBalance}
            perAction={minimumForOneAction(position, guard.policy)}
          />
          <RuleLine guard={guard} />
          <Controls guard={guard} obligation={position.obligation} now={now} />
        </>
      )}

      <DemoControls />
    </div>
  );
}
