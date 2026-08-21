import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_REPAY, ACTION_TOP_UP, MAX_DELEGATION_SECONDS, MIN_COOLDOWN_SECONDS } from "./program";
import { defaultPolicy, policyIsValid, validatePolicy, type Policy } from "./policy";

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
