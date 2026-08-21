/**
 * How far a reserve goes.
 *
 * PLATFORM.md 2.4 asks the reserve screen two questions and this file answers both:
 * the minimum for one firing of the current rule, and what it takes to hold the
 * position through a 20, 30 or 40 percent fall. Both are computed from the live
 * position rather than quoted from a table, because a reserve that covered a 40%
 * fall last week covers less of one after the debt grows.
 */

import type { Policy } from "@/lib/core/policy";
import { afterPriceMove, positionLtvBps, repayValueToTarget, type PositionSnapshot } from "@/lib/core/position";

/** Falls the reserve screen sizes against, as fractions of the current price. */
export const COVERAGE_DROPS = [0.2, 0.3, 0.4] as const;

/**
 * Reserve needed for one action, in quote base units.
 *
 * Measured at the trigger and not at today's price. The agent does not act until
 * LTV reaches the trigger, so the first action is always the one that carries the
 * position from the trigger back to the target, whatever the price is when it
 * happens. Sizing this off the current healthy LTV would understate it.
 *
 * Capped by the policy's per-action limit, because the program will not send more
 * than that in one instruction however much is in the vault.
 */
export function minimumForOneAction(position: PositionSnapshot, policy: Policy): bigint {
  // At the trigger, debtValue / collateralValue == trigger / BPS. Solving for the
  // collateral value gives the position the agent will actually see.
  const collateralAtTrigger =
    (position.debtValue * 10_000n) / BigInt(Math.max(1, policy.triggerLtvBps));

  const needed = repayValueToTarget(
    { ...position, collateralValue: collateralAtTrigger },
    policy.targetLtvBps,
  );

  return needed < policy.maxActionAmount ? needed : policy.maxActionAmount;
}

export interface CoverageRow {
  /** Fall in the collateral price, as a fraction. */
  drop: number;
  /** LTV the position reaches after the fall if nothing is done, in basis points. */
  ltvBpsAfterDrop: number;
  /** Quote base units needed to restore the target after the fall. */
  required: bigint;
  /** Whether the rule would even fire at that LTV. */
  ruleFires: boolean;
  /** Whether the reserve holds enough. */
  covered: boolean;
  shortfall: bigint;
  /**
   * Whether the rule could deliver that much inside one window.
   *
   * Money in the vault is not the only limit. The policy caps each action and caps
   * how many actions a window allows, so a fall can be affordable and undeliverable
   * at the same time. A reserve screen that only checked the balance would answer
   * "covered" to a fall the rule cannot act its way out of.
   */
  withinRuleLimits: boolean;
  /** Most the rule can spend in one window, in quote base units. */
  perWindowCeiling: bigint;
  /**
   * Whether the fall takes the position past the liquidation threshold before any
   * action. The agent acts on the way down, so this is not a verdict; it is the
   * reason the row cannot be read as a promise.
   */
  passesLiquidation: boolean;
}

/**
 * What a fall of each size costs, and whether the reserve covers it.
 *
 * The required figure is the whole repay back to the target, which can be more than
 * the per-action cap allows in one go. That is deliberate: the question the user is
 * asking is "does my money cover this fall", and answering it with one capped action
 * would say yes to a fall that needs three.
 */
export function coverage(
  position: PositionSnapshot,
  policy: Policy,
  reserveBalance: bigint,
  drops: readonly number[] = COVERAGE_DROPS,
): CoverageRow[] {
  const perWindowCeiling = policy.maxActionAmount * BigInt(policy.maxActionsPerWindow);

  return drops.map((drop) => {
    const fallen = afterPriceMove(position, -drop);
    const ltvBpsAfterDrop = positionLtvBps(fallen);
    const ruleFires = ltvBpsAfterDrop >= policy.triggerLtvBps;
    const required = ruleFires ? repayValueToTarget(fallen, policy.targetLtvBps) : 0n;
    const covered = reserveBalance >= required;

    return {
      drop,
      ltvBpsAfterDrop,
      required,
      ruleFires,
      covered,
      shortfall: covered ? 0n : required - reserveBalance,
      withinRuleLimits: required <= perWindowCeiling,
      perWindowCeiling,
      passesLiquidation: ltvBpsAfterDrop >= position.liquidationLtvBps,
    };
  });
}

/**
 * Whole firings the reserve still funds at the current rule.
 *
 * An approximation, and it errs low: each action reduces the debt, so the next one
 * costs slightly less than the last. Rounding down is the right direction for a
 * number a user plans around.
 */
export function firingsLeft(reserveBalance: bigint, perAction: bigint): number {
  if (perAction <= 0n) return 0;
  return Number(reserveBalance / perAction);
}

/**
 * The largest fall the rule and the reserve together hold the position through, as
 * a fraction, searched to the nearest percent. `null` when nothing this model
 * reaches breaks it.
 *
 * Both limits count. A fall the reserve can afford but the rule cannot deliver
 * inside its window is not a fall the position is held through, and reporting it as
 * one is the kind of number a user plans around and then loses money on.
 *
 * A coarse search on purpose. The answer is shown as "about 34%" and a bisection to
 * four decimal places would imply a precision the price feed does not have.
 */
export function furthestCoveredDrop(
  position: PositionSnapshot,
  policy: Policy,
  reserveBalance: bigint,
): number | null {
  for (let percent = 1; percent <= 99; percent++) {
    const [row] = coverage(position, policy, reserveBalance, [percent / 100]);
    if (!row.covered || !row.withinRuleLimits) return (percent - 1) / 100;
  }
  return null;
}
