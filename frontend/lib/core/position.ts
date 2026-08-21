/**
 * A borrow position, as the guard reads it.
 *
 * The two fields that decide anything are `collateralValue` and `debtValue`: exact
 * integers in the obligation's risk-adjusted quote scale, the same pair the program
 * hands to `ltv_bps`. Everything else on this type is for display. Keeping the
 * decision inputs exact and separate from the display inputs is the whole of
 * PLATFORM.md 4: a panel that renders 71.6% and a program that computes 7159 bps
 * have not disagreed, but a panel that recomputes 71.59% from a rounded price has.
 */

import { ltvBpsFromValues, repayValueForTarget } from "@/lib/core/ltv/calc";
import { QUOTE_DECIMALS, type TokenAmount } from "@/lib/core/units";

export interface PositionSnapshot {
  /** The obligation account this position lives in. */
  obligation: string;
  /** Market name for display, e.g. "Kamino main market". */
  market: string;
  /** Collateral, for display. The decision runs on `collateralValue`. */
  collateral: TokenAmount;
  /** Spot price of the collateral asset in quote currency, for display. */
  collateralPrice: number;
  /** Debt, for display. */
  debt: TokenAmount;

  /**
   * Risk-adjusted collateral value in quote base units, exactly as the obligation
   * reports it. Never derived from `collateral` times `collateralPrice`.
   */
  collateralValue: bigint;
  /** Borrow-factor adjusted debt value in quote base units. */
  debtValue: bigint;

  /** The market's liquidation threshold. A market parameter, not a user setting. */
  liquidationLtvBps: number;

  /** Unix seconds at which the price behind these values was published. */
  priceUpdatedAt: number;
}

/** The reading every threshold comparison in the interface runs on. */
export function positionLtvBps(position: PositionSnapshot): number {
  return ltvBpsFromValues(position.collateralValue, position.debtValue);
}

/**
 * Quote value that has to be repaid to bring the position to `targetLtvBps`.
 *
 * This is a VALUE, not a token amount. They coincide today because the guard's
 * reserve mint is required to equal the debt reserve's liquidity mint
 * (`init_guard` checks it) and that mint is USDC at a borrow factor of one. A
 * market with a borrow factor above one would need the value divided by it before
 * it became an amount to transfer, and that conversion belongs next to the market
 * adapter rather than hidden in a display helper.
 */
export function repayValueToTarget(position: PositionSnapshot, targetLtvBps: number): bigint {
  return repayValueForTarget(position.collateralValue, position.debtValue, targetLtvBps);
}

/**
 * The same position after the collateral price moves by `fraction` (-0.2 is a 20%
 * fall). Only the collateral side moves: the debt is denominated in the quote asset.
 *
 * Used to answer "how much reserve covers a 30% fall" without a second model of the
 * position living in the reserve screen.
 */
export function afterPriceMove(position: PositionSnapshot, fraction: number): PositionSnapshot {
  const multiplier = 1 + fraction;
  const scaled = (value: bigint) =>
    (value * BigInt(Math.round(multiplier * 1_000_000))) / 1_000_000n;

  return {
    ...position,
    collateralPrice: position.collateralPrice * multiplier,
    collateralValue: scaled(position.collateralValue),
  };
}

/** Price of the collateral asset at which this position would be liquidated. */
export function liquidationPriceOf(position: PositionSnapshot): number {
  const ltv = positionLtvBps(position);
  if (ltv <= 0) return 0;
  return (position.collateralPrice * ltv) / position.liquidationLtvBps;
}

export { QUOTE_DECIMALS };
