import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_REPAY,
  ACTION_SCHEDULED_REPAY,
  ACTION_TOP_UP,
  MAX_DELEGATION_SECONDS,
  MIN_COOLDOWN_SECONDS,
  MIN_SCHEDULE_SECONDS,
} from "./program";
import {
  SCHEDULE_PRESETS,
  defaultPolicy,
  hasSchedule,
  nextScheduledAt,
  policyIsValid,
  validatePolicy,
  withSchedule,
  type Policy,
} from "./policy";

/**
 * The same cases `state.rs::tests` runs against `PolicyParams::validate`, plus the
 * ones the interface can hit that the program's unit tests do not cover. If one of
 * these goes red the web is about to let a user sign a transaction the chain will
 * reject.
 */

const NOW = 1_700_000_000;

function policy(overrides: Partial<Policy> = {}): Policy {
  return { ...defaultPolicy(NOW), ...overrides };
}

function fields(candidate: Policy, liquidationLtvBps?: number): string[] {
  return validatePolicy(candidate, { now: NOW, liquidationLtvBps }).map((problem) => problem.field);
}

test("the default policy is one the program would accept", () => {
  assert.deepEqual(fields(policy()), []);
});

test("the target has to sit below the trigger", () => {
  assert.deepEqual(fields(policy({ targetLtvBps: 7_000, triggerLtvBps: 7_000 })), ["targetLtvBps"]);
  assert.deepEqual(fields(policy({ targetLtvBps: 7_500, triggerLtvBps: 7_000 })), ["targetLtvBps"]);
});

test("a trigger above 100% is rejected", () => {
  assert.ok(fields(policy({ triggerLtvBps: 10_001 })).includes("triggerLtvBps"));
});

test("the per-action cap has to be greater than zero", () => {
  assert.deepEqual(fields(policy({ maxActionAmount: 0n })), ["maxActionAmount"]);
});

test("the window has to allow at least one action", () => {
  assert.deepEqual(fields(policy({ maxActionsPerWindow: 0 })), ["maxActionsPerWindow"]);
});

test("the action counter is one byte on chain", () => {
  assert.deepEqual(fields(policy({ maxActionsPerWindow: 256 })), ["maxActionsPerWindow"]);
});

test("the cooldown floor comes from the program", () => {
  assert.deepEqual(fields(policy({ cooldownSeconds: MIN_COOLDOWN_SECONDS - 1 })), ["cooldownSeconds"]);
  assert.deepEqual(fields(policy({ cooldownSeconds: MIN_COOLDOWN_SECONDS })), []);
});

test("top up is rejected in v1, exactly as the program rejects it", () => {
  assert.deepEqual(fields(policy({ allowedActions: ACTION_REPAY | ACTION_TOP_UP })), ["allowedActions"]);
  assert.deepEqual(fields(policy({ allowedActions: ACTION_TOP_UP })), ["allowedActions"]);
});

test("an authorization cannot be granted already expired", () => {
  assert.deepEqual(fields(policy({ expiresAt: NOW })), ["expiresAt"]);
  assert.deepEqual(fields(policy({ expiresAt: NOW - 1 })), ["expiresAt"]);
});

test("ninety days is the longest authorization, to the second", () => {
  assert.deepEqual(fields(policy({ expiresAt: NOW + MAX_DELEGATION_SECONDS })), []);
  assert.deepEqual(fields(policy({ expiresAt: NOW + MAX_DELEGATION_SECONDS + 1 })), ["expiresAt"]);
});

test("the trigger has to sit below the market's liquidation threshold", () => {
  assert.deepEqual(fields(policy({ triggerLtvBps: 8_000 }), 8_000), ["triggerLtvBps"]);
  assert.deepEqual(fields(policy({ triggerLtvBps: 7_999 }), 8_000), []);
});

test("the liquidation rule is skipped rather than guessed when the position is unknown", () => {
  assert.ok(policyIsValid(policy({ triggerLtvBps: 9_000 }), { now: NOW }));
});

test("every problem carries the error the program would return", () => {
  const problems = validatePolicy(policy({ maxActionAmount: 0n, cooldownSeconds: 1 }), { now: NOW });
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.equal(problem.error, "InvalidPolicy");
});

/**
 * The schedule half of `PolicyParams::validate`. Same cases as
 * `state.rs::tests`, because the point of this file is that the interface refuses a
 * policy for the reason the program would, before a wallet ever opens.
 */

const WEEKLY = { everySeconds: SCHEDULE_PRESETS.weekly, amount: 50_000_000n };

test("a weekly schedule is a policy the program would accept", () => {
  assert.deepEqual(fields(withSchedule(policy(), WEEKLY)), []);
});

test("emergency repay cannot be switched off in favour of the schedule", () => {
  assert.deepEqual(
    fields(policy({ allowedActions: ACTION_SCHEDULED_REPAY, scheduleSeconds: SCHEDULE_PRESETS.weekly, scheduleAmount: 1n })),
    ["allowedActions"],
  );
});

test("an hour is the shortest interval the program accepts", () => {
  const short = { everySeconds: MIN_SCHEDULE_SECONDS - 1, amount: 1n };
  assert.deepEqual(fields(withSchedule(policy(), short)), ["scheduleSeconds"]);
  assert.deepEqual(fields(withSchedule(policy(), { ...short, everySeconds: MIN_SCHEDULE_SECONDS })), []);
});

test("a schedule longer than the longest authorization could never run", () => {
  assert.deepEqual(
    fields(withSchedule(policy(), { everySeconds: MAX_DELEGATION_SECONDS + 1, amount: 1n })),
    ["scheduleSeconds"],
  );
});

test("a scheduled payment needs an amount", () => {
  assert.deepEqual(fields(withSchedule(policy(), { ...WEEKLY, amount: 0n })), ["scheduleAmount"]);
});

/**
 * The fail-closed half. Numbers the mask does not cover must not survive into the
 * account, or flipping the bit later arms a schedule nobody agreed to.
 */
test("schedule settings without the grant are refused rather than stored", () => {
  assert.deepEqual(fields(policy({ scheduleSeconds: SCHEDULE_PRESETS.weekly })), ["scheduleSeconds"]);
  assert.deepEqual(fields(policy({ scheduleAmount: 1n })), ["scheduleSeconds"]);
});

test("removing a schedule clears both halves at once", () => {
  const off = withSchedule(withSchedule(policy(), WEEKLY), null);
  assert.equal(off.allowedActions, ACTION_REPAY);
  assert.equal(off.scheduleSeconds, 0);
  assert.equal(off.scheduleAmount, 0n);
  assert.equal(hasSchedule(off), false);
  assert.deepEqual(fields(off), []);
});

test("the next payment is measured from the last one, not from a fixed grid", () => {
  const scheduled = withSchedule(policy(), WEEKLY);
  assert.equal(
    nextScheduledAt({ policy: scheduled, lastScheduledAt: NOW }),
    NOW + SCHEDULE_PRESETS.weekly,
  );
  // A payment that landed late moves the next one out rather than leaving a second
  // one instantly owing, which is what `GuardConfig::schedule_due` does.
  assert.equal(
    nextScheduledAt({ policy: scheduled, lastScheduledAt: NOW + 3_600 }),
    NOW + 3_600 + SCHEDULE_PRESETS.weekly,
  );
  assert.equal(nextScheduledAt({ policy: policy(), lastScheduledAt: NOW }), null);
});
