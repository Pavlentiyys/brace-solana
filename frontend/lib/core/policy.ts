/**
 * The policy a user authorizes, and the rules the program applies to it.
 *
 * `validatePolicy` is a line by line mirror of `PolicyParams::validate` in
 * `program/programs/guard/src/state.rs`. It exists so that the interface can refuse
 * a policy for the same reason the program would, before a wallet ever opens. A
 * rejected transaction costs a fee and teaches the user nothing.
 *
 * Mirroring means the two can drift, so every rule here names the Rust `require!`
 * it copies, and `policy.test.ts` walks the same cases.
 */

import { BPS } from "@/lib/core/ltv/calc";
import {
  ACTION_SCHEDULED_REPAY,
  ALLOWED_ACTIONS_SCHEDULED,
  ALLOWED_ACTIONS_V1,
  MAX_DELEGATION_SECONDS,
  MIN_COOLDOWN_SECONDS,
  MIN_SCHEDULE_SECONDS,
  actionsInMask,
  type ActionKind,
} from "@/lib/core/program";

export interface Policy {
  /** The agent acts at or above this LTV, in basis points. */
  triggerLtvBps: number;
  /** The LTV an action aims to restore, in basis points. Strictly below the trigger. */
  targetLtvBps: number;
  /** Per-action cap, in base units of the reserve mint (USDC has six decimals). */
  maxActionAmount: bigint;
  maxActionsPerWindow: number;
  windowSeconds: number;
  cooldownSeconds: number;
  /** Bitmask of `ACTION_*`. */
  allowedActions: number;
  /**
   * Seconds between scheduled repayments. Zero when the rule has no schedule.
   *
   * The program requires this to be zero unless `allowedActions` carries
   * `ACTION_SCHEDULED_REPAY`, so a schedule cannot sit dormant in an account
   * waiting for somebody to flip the bit.
   */
  scheduleSeconds: number;
  /** Cap on one scheduled repayment, in base units of the reserve mint. */
  scheduleAmount: bigint;
  /** Unix seconds. The authorization is dead after this instant. */
  expiresAt: number;
}

export type PolicyField =
  | "triggerLtvBps"
  | "targetLtvBps"
  | "maxActionAmount"
  | "maxActionsPerWindow"
  | "windowSeconds"
  | "cooldownSeconds"
  | "allowedActions"
  | "scheduleSeconds"
  | "scheduleAmount"
  | "expiresAt";

export interface PolicyProblem {
  field: PolicyField;
  /** The Rust error the program would return for this. */
  error: "InvalidPolicy";
  message: string;
}

export interface PolicyContext {
  /** Unix seconds. */
  now: number;
  /**
   * The market's liquidation threshold for this position, in basis points.
   *
   * `init_guard` and `update_policy` both read it from the obligation and require
   * the trigger to sit strictly below it. Omit it only when the position is not
   * known yet; then this one rule is skipped instead of guessed.
   */
  liquidationLtvBps?: number;
}

/**
 * Every reason the program would reject this policy, in the order the program
 * checks them. An empty array means `PolicyParams::validate` would pass.
 */
export function validatePolicy(policy: Policy, context: PolicyContext): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  const reject = (field: PolicyField, message: string) =>
    problems.push({ field, error: "InvalidPolicy", message });

  // require!(trigger <= BPS && target < trigger)
  if (!Number.isInteger(policy.triggerLtvBps) || policy.triggerLtvBps <= 0 || policy.triggerLtvBps > BPS) {
    reject("triggerLtvBps", `The trigger has to be a whole number of basis points between 1 and ${BPS}.`);
  }
  if (policy.targetLtvBps >= policy.triggerLtvBps) {
    reject("targetLtvBps", "The target has to be below the trigger, otherwise an action cannot improve anything.");
  }
  if (policy.targetLtvBps < 0) {
    reject("targetLtvBps", "The target cannot be negative.");
  }

  // require!(max_action_amount > 0)
  if (policy.maxActionAmount <= 0n) {
    reject("maxActionAmount", "The per-action cap has to be greater than zero.");
  }

  // require!(max_actions_per_window > 0)
  if (policy.maxActionsPerWindow <= 0) {
    reject("maxActionsPerWindow", "The window has to allow at least one action.");
  }
  // u8 on chain.
  if (policy.maxActionsPerWindow > 255) {
    reject("maxActionsPerWindow", "The program stores this in one byte, so 255 is the most it can hold.");
  }

  // require!(window_seconds > 0)
  if (policy.windowSeconds <= 0) {
    reject("windowSeconds", "The window has to be longer than zero seconds.");
  }

  // require!(cooldown_seconds >= MIN_COOLDOWN_SECONDS)
  if (policy.cooldownSeconds < MIN_COOLDOWN_SECONDS) {
    reject("cooldownSeconds", `The program requires at least ${MIN_COOLDOWN_SECONDS} seconds between actions.`);
  }

  // require!(allowed_actions == ACTION_REPAY || allowed_actions == ACTION_REPAY | ACTION_SCHEDULED_REPAY)
  if (
    policy.allowedActions !== ALLOWED_ACTIONS_V1 &&
    policy.allowedActions !== ALLOWED_ACTIONS_SCHEDULED
  ) {
    reject(
      "allowedActions",
      "The program repays debt and nothing else, and emergency repay cannot be switched off.",
    );
  }

  // The schedule block of `PolicyParams::validate`, both halves.
  if ((policy.allowedActions & ACTION_SCHEDULED_REPAY) !== 0) {
    if (policy.scheduleSeconds < MIN_SCHEDULE_SECONDS) {
      reject("scheduleSeconds", "The shortest schedule the program accepts is one hour.");
    }
    if (policy.scheduleSeconds > MAX_DELEGATION_SECONDS) {
      reject(
        "scheduleSeconds",
        "A schedule longer than the longest authorization could never run, so the program refuses it.",
      );
    }
    if (policy.scheduleAmount <= 0n) {
      reject("scheduleAmount", "A scheduled payment needs an amount above zero.");
    }
  } else if (policy.scheduleSeconds !== 0 || policy.scheduleAmount > 0n) {
    reject(
      "scheduleSeconds",
      "The rule carries schedule settings it does not permit. The program refuses that rather than storing a schedule nobody switched on.",
    );
  }

  // require!(expires_at > now && expires_at <= now + MAX_DELEGATION_SECONDS)
  if (policy.expiresAt <= context.now) {
    reject("expiresAt", "The authorization would already be expired.");
  } else if (policy.expiresAt > context.now + MAX_DELEGATION_SECONDS) {
    reject("expiresAt", "The program will not hold an authorization for longer than ninety days.");
  }

  // require!(trigger < position.liquidation_ltv), checked against the obligation.
  if (
    context.liquidationLtvBps !== undefined &&
    policy.triggerLtvBps >= context.liquidationLtvBps
  ) {
    reject(
      "triggerLtvBps",
      "The trigger has to sit below the market's liquidation threshold. Above it the agent would only ever act on a position that is already being liquidated.",
    );
  }

  return problems;
}

export function policyIsValid(policy: Policy, context: PolicyContext): boolean {
  return validatePolicy(policy, context).length === 0;
}

/** The actions this policy permits, as names rather than a bitmask. */
export function policyActions(policy: Policy): ActionKind[] {
  return actionsInMask(policy.allowedActions);
}

/**
 * Longest authorization the program will accept, from `now`.
 *
 * PLATFORM.md 2.3 requires the interface to show this as a DATE and not as a
 * duration: "your authorization ends on 19 November" is checkable against a
 * calendar, and "90 days" is a number the reader has to do arithmetic on.
 */
export function maximumExpiry(now: number): number {
  return now + MAX_DELEGATION_SECONDS;
}

/**
 * The starting policy the authorization screen offers.
 *
 * The rule itself is set in the chat (PLATFORM.md 3.3), so this is only the shape
 * the web fills in when it has nothing from the bot yet. The values are the ones a
 * two step rule collapses to when the program can only repay: fire at the trigger,
 * restore the target, cap each action, and expire in thirty days rather than the
 * ninety the program allows.
 */
export function defaultPolicy(now: number): Policy {
  return {
    triggerLtvBps: 7_000,
    targetLtvBps: 6_200,
    maxActionAmount: 900_000_000n,
    maxActionsPerWindow: 3,
    windowSeconds: 24 * 60 * 60,
    cooldownSeconds: 300,
    allowedActions: ALLOWED_ACTIONS_V1,
    scheduleSeconds: 0,
    scheduleAmount: 0n,
    expiresAt: now + 30 * 24 * 60 * 60,
  };
}

/** Whether this rule includes a repayment schedule. */
export function hasSchedule(policy: Policy): boolean {
  return (policy.allowedActions & ACTION_SCHEDULED_REPAY) !== 0 && policy.scheduleSeconds > 0;
}

/**
 * The same policy with a schedule attached, or without one.
 *
 * Written as one function because the mask and the two numbers have to move
 * together: the program rejects a policy that carries either half alone, and
 * splitting this into setters is how that pair drifts apart.
 */
export function withSchedule(
  policy: Policy,
  schedule: { everySeconds: number; amount: bigint } | null,
): Policy {
  if (schedule === null) {
    return { ...policy, allowedActions: ALLOWED_ACTIONS_V1, scheduleSeconds: 0, scheduleAmount: 0n };
  }
  return {
    ...policy,
    allowedActions: ALLOWED_ACTIONS_SCHEDULED,
    scheduleSeconds: schedule.everySeconds,
    scheduleAmount: schedule.amount,
  };
}

/** Common intervals, as the chat offers them. */
export const SCHEDULE_PRESETS = {
  daily: 24 * 60 * 60,
  weekly: 7 * 24 * 60 * 60,
  fortnightly: 14 * 24 * 60 * 60,
  monthly: 30 * 24 * 60 * 60,
} as const;

export type SchedulePreset = keyof typeof SCHEDULE_PRESETS;

/**
 * When the next scheduled payment is due, in unix seconds.
 *
 * Measured from the last run rather than from a fixed grid, matching
 * `GuardConfig::schedule_due`. A payment that landed late moves the next one out;
 * it does not leave a second one instantly owing.
 */
export function nextScheduledAt(guard: {
  policy: Policy;
  lastScheduledAt: number;
}): number | null {
  if (!hasSchedule(guard.policy)) return null;
  return guard.lastScheduledAt + guard.policy.scheduleSeconds;
}
