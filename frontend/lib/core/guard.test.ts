import assert from "node:assert/strict";
import test from "node:test";

import {
  agentReadiness,
  authorityStatus,
  blockers,
  cooldownRemaining,
  dropToLtv,
  expiryIsNear,
  priceAtLtv,
  windowUsage,
  type Guard,
} from "./guard";
import { agoLabel, durationLabel, watcherLiveness } from "./liveness";
import { defaultPolicy } from "./policy";

const NOW = 1_700_000_000;

function guard(overrides: Partial<Guard> = {}): Guard {
  return {
    address: "GuardAddress",
    owner: "Owner",
    agent: "Agent",
    obligation: "Obligation",
    lendingMarket: "Market",
    debtReserve: "Reserve",
    vault: "Vault",
    vaultMint: "Mint",
    policy: defaultPolicy(NOW),
    paused: false,
    lastActionAt: 0,
    windowStartedAt: NOW,
    actionsInWindow: 0,
    totalActions: 0,
    totalRepaid: 0n,
    ...overrides,
  };
}

test("a revoked guard is recognised by its empty action mask", () => {
  // `revoke` pauses, expires and clears the mask in one instruction. The empty mask
  // is the part no other path produces.
  const revoked = guard({
    paused: true,
    policy: { ...defaultPolicy(NOW), allowedActions: 0, expiresAt: NOW },
  });
  assert.equal(authorityStatus(revoked, NOW), "revoked");
});

test("expiry outranks pause, because resuming would not bring it back", () => {
  const expired = guard({ paused: true, policy: { ...defaultPolicy(NOW), expiresAt: NOW - 1 } });
  assert.equal(authorityStatus(expired, NOW), "expired");
});

test("the action counter rolls forward instead of showing a stale window", () => {
  const policy = defaultPolicy(NOW);
  const spent = guard({ actionsInWindow: policy.maxActionsPerWindow, windowStartedAt: NOW });

  const during = windowUsage(spent, NOW + policy.windowSeconds - 1);
  assert.equal(during.used, policy.maxActionsPerWindow);
  assert.equal(during.exhausted, true);

  const after = windowUsage(spent, NOW + policy.windowSeconds);
  assert.equal(after.used, 0);
  assert.equal(after.exhausted, false);
  assert.equal(after.resetsAt, NOW + policy.windowSeconds + policy.windowSeconds);
});

test("a guard that has never acted is not cooling down", () => {
  assert.equal(cooldownRemaining(guard(), NOW), 0);
});

test("the cooldown counts from the last action", () => {
  const policy = defaultPolicy(NOW);
  const acted = guard({ lastActionAt: NOW });
  assert.equal(cooldownRemaining(acted, NOW + 60), policy.cooldownSeconds - 60);
  assert.equal(cooldownRemaining(acted, NOW + policy.cooldownSeconds), 0);
});

test("a healthy position reads as watching, not as broken", () => {
  const readiness = agentReadiness(guard(), { now: NOW, ltvBps: 5_000, reserveBalance: 1_000_000n });
  assert.equal(readiness.state, "watching");
  assert.deepEqual(readiness.blockers, ["below_trigger"]);
});

test("a position at the trigger with a funded reserve reads as armed", () => {
  const readiness = agentReadiness(guard(), { now: NOW, ltvBps: 7_000, reserveBalance: 1_000_000n });
  assert.equal(readiness.state, "armed");
  assert.deepEqual(readiness.blockers, []);
});

test("a cooldown on a healthy position is a note, not an alarm", () => {
  // The cooldown always follows an action that just worked. Reporting "would not
  // act" seconds after the agent acted reads as a malfunction.
  const acted = guard({ lastActionAt: NOW });
  const readiness = agentReadiness(acted, { now: NOW, ltvBps: 5_000, reserveBalance: 1_000_000n });

  assert.equal(readiness.state, "watching");
  assert.ok(readiness.blockers.includes("cooling_down"));
});

test("a cooldown at the trigger is an alarm, because it stops a needed action", () => {
  const acted = guard({ lastActionAt: NOW });
  const readiness = agentReadiness(acted, { now: NOW, ltvBps: 7_500, reserveBalance: 1_000_000n });

  assert.equal(readiness.state, "would_not_act");
});

test("a rate limited guard would not act even while the position is healthy", () => {
  // Unlike the cooldown, an exhausted window survives the position getting worse.
  const spent = guard({ actionsInWindow: defaultPolicy(NOW).maxActionsPerWindow });
  const readiness = agentReadiness(spent, { now: NOW, ltvBps: 5_000, reserveBalance: 1_000_000n });

  assert.equal(readiness.state, "would_not_act");
  assert.ok(readiness.blockers.includes("rate_limited"));
});

test("an empty reserve means the agent would not act, however healthy the position", () => {
  const readiness = agentReadiness(guard(), { now: NOW, ltvBps: 5_000, reserveBalance: 0n });
  assert.equal(readiness.state, "would_not_act");
  assert.ok(readiness.blockers.includes("reserve_empty"));
});

test("every reason the agent would not act is reported, not just the first", () => {
  const paused = guard({ paused: true, lastActionAt: NOW });
  const found = blockers(paused, { now: NOW, ltvBps: 5_000, reserveBalance: 0n });
  assert.deepEqual(found.sort(), ["below_trigger", "cooling_down", "paused", "reserve_empty"]);
});

test("expiry inside seven days is the warning window from section 3.8", () => {
  const week = 7 * 24 * 60 * 60;
  assert.equal(expiryIsNear(guard({ policy: { ...defaultPolicy(NOW), expiresAt: NOW + week } }), NOW), true);
  assert.equal(expiryIsNear(guard({ policy: { ...defaultPolicy(NOW), expiresAt: NOW + week + 1 } }), NOW), false);
  // Already expired is a different state, not a warning.
  assert.equal(expiryIsNear(guard({ policy: { ...defaultPolicy(NOW), expiresAt: NOW } }), NOW), false);
});

test("LTV moves inversely with the collateral price", () => {
  // Halve the price and the ratio doubles.
  assert.equal(priceAtLtv(200, 3_500, 7_000), 100);
  assert.equal(dropToLtv(3_500, 7_000), 0.5);
  assert.equal(dropToLtv(7_000, 7_000), 0);
});

test("the watcher degrades in two steps and the second one is the acceptance bound", () => {
  assert.equal(watcherLiveness(NOW - 4, NOW).state, "fresh");
  assert.equal(watcherLiveness(NOW - 20, NOW).state, "lagging");
  assert.equal(watcherLiveness(NOW - 59, NOW).state, "lagging");
  // Section 7: more than sixty seconds of lag has to be visible.
  assert.equal(watcherLiveness(NOW - 60, NOW).state, "stalled");
  assert.equal(watcherLiveness(null, NOW).state, "unknown");
});

test("clock skew does not raise an alarm", () => {
  assert.equal(watcherLiveness(NOW + 3, NOW).state, "fresh");
  assert.equal(watcherLiveness(NOW + 3, NOW).secondsAgo, 0);
});

test("elapsed time is written the way it is read aloud", () => {
  assert.equal(agoLabel(4), "4 seconds ago");
  assert.equal(agoLabel(1), "1 second ago");
  assert.equal(agoLabel(90), "1 minute ago");
  assert.equal(agoLabel(null), "never");
  assert.equal(durationLabel(0), "expired");
  assert.equal(durationLabel(86_400), "1 day");
  assert.equal(durationLabel(3_600), "1 hour");
  assert.equal(durationLabel(30), "1 minute");
});
