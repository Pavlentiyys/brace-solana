/**
 * The `GuardConfig` account as the interface sees it, and everything the panel
 * derives from it.
 *
 * The derivations live here rather than in a component for the reason PLATFORM.md 4
 * gives about LTV: the same question gets asked by the web, by the bot and by the
 * watcher, and three answers that disagree by a second or a basis point become
 * false alarms. The panel renders what this file returns.
 */

import { BPS } from "@/lib/core/ltv/calc";
import type { Policy } from "@/lib/core/policy";

/** A `GuardConfig` account, addresses as base58 strings. */
export interface Guard {
  address: string;
  owner: string;
  agent: string;
  obligation: string;
  lendingMarket: string;
  debtReserve: string;
  vault: string;
  vaultMint: string;

  policy: Policy;
  paused: boolean;

  /** Unix seconds, 0 when the agent has never acted. */
  lastActionAt: number;
  windowStartedAt: number;
  actionsInWindow: number;
  /**
   * Unix seconds of the last scheduled payment, and the clock the next one is
   * measured from. Set at authorization, so a weekly schedule pays in a week
   * rather than immediately.
   */
  lastScheduledAt: number;
  totalActions: number;
  /** Base units of the reserve mint, cumulative. */
  totalRepaid: bigint;
}

/**
 * What the authorization is doing right now.
 *
 * Revocation is not a flag of its own on chain: `revoke` pauses, expires and clears
 * the action mask in one instruction. An empty mask is the part of that no other
 * path produces, so it is what identifies a revoked guard.
 */
export type AuthorityStatus = "active" | "paused" | "expired" | "revoked";

export function authorityStatus(guard: Guard, now: number): AuthorityStatus {
  if (guard.policy.allowedActions === 0) return "revoked";
  if (now >= guard.policy.expiresAt) return "expired";
  if (guard.paused) return "paused";
  return "active";
}

/** Whether the program would let the agent act at all, ignoring LTV. */
export function authorityIsLive(guard: Guard, now: number): boolean {
  return authorityStatus(guard, now) === "active";
}

export interface WindowUsage {
  used: number;
  limit: number;
  /** Unix seconds at which the counter goes back to zero. */
  resetsAt: number;
  exhausted: boolean;
}

/**
 * The action counter, rolled forward the way `GuardConfig::next_window` rolls it.
 *
 * The stored counter is stale between actions: the program only resets it when the
 * next action arrives. Reading the raw field would show "3 of 3 used" hours after
 * the window ended, which is a lie in the direction that makes the user think they
 * are unprotected.
 */
export function windowUsage(guard: Guard, now: number): WindowUsage {
  const { windowSeconds, maxActionsPerWindow } = guard.policy;
  const elapsed = now - guard.windowStartedAt;
  const rolled = elapsed >= windowSeconds;
  const used = rolled ? 0 : guard.actionsInWindow;
  const startedAt = rolled ? now : guard.windowStartedAt;

  return {
    used,
    limit: maxActionsPerWindow,
    resetsAt: startedAt + windowSeconds,
    exhausted: used >= maxActionsPerWindow,
  };
}

/** Seconds until the cooldown between actions elapses. Zero when it already has. */
export function cooldownRemaining(guard: Guard, now: number): number {
  if (guard.lastActionAt === 0) return 0;
  return Math.max(0, guard.lastActionAt + guard.policy.cooldownSeconds - now);
}

/** Seconds until the authorization expires. Zero once it has. */
export function secondsUntilExpiry(guard: Guard, now: number): number {
  return Math.max(0, guard.policy.expiresAt - now);
}

/**
 * PLATFORM.md 3.8 calls an expiry inside seven days a case that needs the user's
 * attention, so it is a named threshold and not a number typed into a component.
 */
export const EXPIRY_WARNING_SECONDS = 7 * 24 * 60 * 60;

export function expiryIsNear(guard: Guard, now: number): boolean {
  const left = secondsUntilExpiry(guard, now);
  return left > 0 && left <= EXPIRY_WARNING_SECONDS;
}

/**
 * Why the agent would not act on this position at this instant.
 *
 * Empty means it would. The panel shows this as the agent's status line, because
 * "armed" and "armed but rate limited for another two hours" are different
 * situations and only one of them is protection.
 */
export type Blocker =
  | "revoked"
  | "expired"
  | "paused"
  | "below_trigger"
  | "rate_limited"
  | "cooling_down"
  | "reserve_empty";

export function blockers(
  guard: Guard,
  options: { now: number; ltvBps: number; reserveBalance: bigint },
): Blocker[] {
  const found: Blocker[] = [];
  const status = authorityStatus(guard, options.now);

  if (status === "revoked") found.push("revoked");
  if (status === "expired") found.push("expired");
  if (status === "paused") found.push("paused");
  if (options.ltvBps < guard.policy.triggerLtvBps) found.push("below_trigger");
  if (windowUsage(guard, options.now).exhausted) found.push("rate_limited");
  if (cooldownRemaining(guard, options.now) > 0) found.push("cooling_down");
  if (options.reserveBalance <= 0n) found.push("reserve_empty");

  return found;
}

/**
 * Blockers that survive the position getting worse.
 *
 * A revoked, expired, paused, unfunded or rate limited guard would not act if the
 * price fell right now, so it is reported as "would not act" even while the position
 * is healthy. The cooldown is not on this list because it is short and it always
 * follows an action that just succeeded: reporting "would not act" seconds after the
 * agent acted reads as a malfunction, and an interface that cries wolf about its own
 * successful work is one the user learns to ignore.
 */
const STANDING_BLOCKERS: readonly Blocker[] = [
  "revoked",
  "expired",
  "paused",
  "rate_limited",
  "reserve_empty",
];

/**
 * The one line answer for the top of the panel.
 *
 * "Watching" is the healthy state: LTV is below the trigger and nothing standing is
 * in the way. "Armed" means the threshold is met and the next check acts. "Would not
 * act" means the agent is not protection right now, and it is the only one of the
 * three that is a call to do something.
 *
 * The cooldown counts only when the trigger is already met, which is the case where
 * it genuinely stops a needed action.
 */
export function agentReadiness(
  guard: Guard,
  options: { now: number; ltvBps: number; reserveBalance: bigint },
): { state: "armed" | "watching" | "would_not_act"; blockers: Blocker[] } {
  const found = blockers(guard, options);
  const standing = found.filter((blocker) => STANDING_BLOCKERS.includes(blocker));
  if (standing.length > 0) return { state: "would_not_act", blockers: found };

  if (found.includes("below_trigger")) return { state: "watching", blockers: found };
  if (found.includes("cooling_down")) return { state: "would_not_act", blockers: found };
  return { state: "armed", blockers: found };
}

/**
 * The price at which the position reaches `ltvTarget`, given where it is now.
 *
 * LTV moves inversely with the collateral price and nothing else in the ratio
 * depends on it, so this is one multiplication. Display only: threshold decisions
 * run on the integer basis points from `ltvBpsFromValues`, never on this.
 */
export function priceAtLtv(currentPrice: number, currentLtvBps: number, ltvTarget: number): number {
  if (ltvTarget <= 0 || currentLtvBps <= 0) return 0;
  return (currentPrice * currentLtvBps) / ltvTarget;
}

/**
 * How far the collateral price can fall before the position reaches `ltvTarget`,
 * as a fraction of the current price. Zero when it is already there.
 */
export function dropToLtv(currentLtvBps: number, ltvTarget: number): number {
  if (currentLtvBps <= 0 || ltvTarget <= 0) return 0;
  if (currentLtvBps >= ltvTarget) return 0;
  return 1 - currentLtvBps / ltvTarget;
}

/** Basis points between the current reading and a threshold. Negative once past it. */
export function bpsUntil(currentLtvBps: number, thresholdBps: number): number {
  return thresholdBps - currentLtvBps;
}

/** Where the position sits between zero and liquidation, as a 0..1 fraction. */
export function healthFraction(currentLtvBps: number, liquidationLtvBps: number): number {
  if (liquidationLtvBps <= 0) return 0;
  return Math.min(1, Math.max(0, currentLtvBps / liquidationLtvBps));
}

export { BPS };
