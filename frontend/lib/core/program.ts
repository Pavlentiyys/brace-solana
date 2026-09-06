/**
 * The on-chain program, mirrored in TypeScript.
 *
 * Everything here has exactly one source of truth in `program/programs/guard/src`
 * and is copied rather than imported, because Rust and TypeScript do not share a
 * compiler. The copies are pinned by `program.test.ts`, which reads the IDL and the
 * Rust sources and fails when they drift.
 *
 * The interface leans on this file harder than it looks. PLATFORM.md 2.3 requires
 * the authorization screen to list what the agent can do "explicitly and verifiably",
 * and the only way that stays true a year from now is if the list is generated from
 * the program's own limits instead of written into a paragraph by hand.
 */

/**
 * The deployed guard, on devnet.
 *
 * Mirrors `declare_id!` in `programs/guard/src/lib.rs`. The interface reads this
 * rather than hiding it: while it was Anchor's placeholder every write said so on
 * screen instead of opening a wallet prompt that could not succeed.
 */
export const PROGRAM_ID = "CCSVvtVuDpH1wCCQWExCpdmZ1sqUBabJA1QQGai7aVaY";

/** False while `PROGRAM_ID` is a placeholder rather than a deployed address. */
export const PROGRAM_IS_DEPLOYED = true;

export const SEED_GUARD = "guard";
export const SEED_VAULT = "vault";

/** `state.rs::MIN_COOLDOWN_SECONDS`. */
export const MIN_COOLDOWN_SECONDS = 30;

/** `state.rs::MAX_DELEGATION_SECONDS`. Ninety days, the longest authorization. */
export const MAX_DELEGATION_SECONDS = 90 * 24 * 60 * 60;

/**
 * `state.rs::ACTION_*`. A bitmask, one bit per permitted action.
 *
 * `TOP_UP` exists in the mask and is rejected by `PolicyParams::validate`, so the
 * program moves money towards the debt and never towards the collateral.
 *
 * `SCHEDULED_REPAY` is a separate grant rather than a setting on `REPAY`, and the
 * authorization screen has to present it that way. `REPAY` lets the agent spend the
 * reserve on a position that has reached the trigger; this one lets it spend on a
 * healthy position, on the interval the owner set.
 */
export const ACTION_REPAY = 1 << 0;
export const ACTION_TOP_UP = 1 << 1;
export const ACTION_SCHEDULED_REPAY = 1 << 2;

/** Emergency repay only: the mask a policy with no schedule carries. */
export const ALLOWED_ACTIONS_V1 = ACTION_REPAY;
/** Emergency repay plus a schedule. The only other mask the program accepts. */
export const ALLOWED_ACTIONS_SCHEDULED = ACTION_REPAY | ACTION_SCHEDULED_REPAY;

/** `state.rs::MIN_SCHEDULE_SECONDS`. */
export const MIN_SCHEDULE_SECONDS = 60 * 60;

export type ActionKind = "repay" | "top_up" | "scheduled_repay";

export const ACTION_BITS: Record<ActionKind, number> = {
  repay: ACTION_REPAY,
  top_up: ACTION_TOP_UP,
  scheduled_repay: ACTION_SCHEDULED_REPAY,
};

/** Actions the deployed program will accept, decoded from a policy's mask. */
export function actionsInMask(mask: number): ActionKind[] {
  return (Object.keys(ACTION_BITS) as ActionKind[]).filter((kind) => (mask & ACTION_BITS[kind]) !== 0);
}

/**
 * Anchor instruction discriminators, from `program/idl/guard.json`.
 *
 * Pinned by test rather than trusted: a discriminator is the one byte string where
 * a silent copy error produces a transaction that fails on chain with nothing in the
 * interface to explain why.
 */
export const DISCRIMINATORS = {
  init_guard: [80, 108, 68, 230, 253, 134, 39, 155],
  deposit_reserve: [187, 75, 224, 96, 122, 233, 220, 121],
  withdraw_reserve: [165, 158, 228, 5, 114, 119, 194, 14],
  update_policy: [212, 245, 246, 7, 163, 151, 18, 57],
  revoke: [170, 23, 31, 34, 133, 173, 93, 242],
  execute_action: [246, 137, 105, 113, 247, 6, 223, 174],
  owner_repay: [205, 18, 148, 210, 27, 12, 229, 49],
  migrate_guard: [175, 134, 32, 40, 68, 232, 134, 180],
} as const satisfies Record<string, readonly number[]>;

export type InstructionName = keyof typeof DISCRIMINATORS;

/** The `GuardConfig` account discriminator, for recognising the account on read. */
export const GUARD_ACCOUNT_DISCRIMINATOR = [95, 175, 118, 50, 193, 113, 37, 250];

/**
 * `errors.rs`, in declaration order. Anchor numbers custom errors from 6000, so the
 * index in this array is the offset from that base and the order is load bearing.
 *
 * `cause` is what the interface shows. The Rust `#[msg]` string is written for a
 * developer reading a transaction log; PLATFORM.md 6 wants the user told what
 * happened in their own terms, and those are not the same sentence.
 */
export const GUARD_ERRORS = [
  { name: "UnauthorizedAgent", cause: "The key that tried to act is not the agent you authorized." },
  { name: "GuardPaused", cause: "The agent is paused, so it did not act." },
  { name: "GuardExpired", cause: "The authorization has expired, so the agent did not act." },
  { name: "CooldownActive", cause: "The cooldown between actions had not elapsed." },
  { name: "RateLimitExceeded", cause: "The action limit for the current window was already used up." },
  { name: "ActionNotAllowed", cause: "Your policy does not permit that action." },
  { name: "AmountExceedsLimit", cause: "The amount was above your per-action cap or above the reserve balance." },
  { name: "StaleObligation", cause: "The position was not refreshed in the same slot, so the agent refused to act on old numbers." },
  { name: "StaleOracle", cause: "The price was too old or too uncertain to act on." },
  { name: "TriggerNotMet", cause: "LTV was below your trigger, so there was nothing to do." },
  { name: "ActionWouldNotImprove", cause: "The action would not have improved the position." },
  { name: "Overcorrection", cause: "The amount would have overshot your target LTV." },
  { name: "InvalidPolicy", cause: "The policy parameters were inconsistent." },
  { name: "MathOverflow", cause: "An arithmetic overflow stopped the action." },
  { name: "UnexpectedProgram", cause: "The lending program was not the expected one." },
  { name: "InvalidExternalAccount", cause: "A market account failed validation." },
  { name: "InvalidMarketRelationship", cause: "The market accounts did not match your guard." },
  { name: "MissingDebtPosition", cause: "The borrow this guard watches is no longer in the obligation." },
  { name: "InvalidRemainingAccounts", cause: "The deposit reserve accounts were missing or out of order." },
  { name: "InvalidAmount", cause: "The amount has to be greater than zero." },
  { name: "ClockMovedBackwards", cause: "The chain clock moved backwards relative to the guard." },
  { name: "PostCpiInvariant", cause: "A safety check after the repay failed, so the whole transaction was rolled back." },
  { name: "ScheduleNotDue", cause: "The next scheduled payment is not due yet." },
  { name: "ScheduleNotConfigured", cause: "Your rule does not include a payment schedule." },
  { name: "UnauthorizedOwner", cause: "That repay has to be signed by the wallet that owns the position." },
] as const;

export const ANCHOR_ERROR_BASE = 6000;

export type GuardErrorName = (typeof GUARD_ERRORS)[number]["name"];

/** Anchor error code for a named guard error, e.g. `GuardExpired` is 6002. */
export function guardErrorCode(name: GuardErrorName): number {
  return ANCHOR_ERROR_BASE + GUARD_ERRORS.findIndex((error) => error.name === name);
}

/**
 * Turns the number in a failed transaction into a sentence for the user.
 *
 * Unknown codes are reported as unknown. Guessing at an unmapped failure is how an
 * interface ends up telling somebody their position is fine when it is not.
 */
export function describeGuardError(code: number): { name: string; cause: string } {
  const entry = GUARD_ERRORS[code - ANCHOR_ERROR_BASE];
  if (!entry) {
    return {
      name: `Unknown error ${code}`,
      cause: "The transaction failed with a code this interface does not recognise.",
    };
  }
  return { name: entry.name, cause: entry.cause };
}
