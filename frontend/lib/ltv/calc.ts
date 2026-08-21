/**
 * Canonical LTV maths for Brace.
 *
 * PLATFORM.md section 4: this formula exists in four implementations (on-chain
 * program, watcher, web, bot) and they are required to agree. A divergence in
 * the third decimal turns into false alarms for the user.
 *
 * Two rules keep them in agreement:
 *
 *   1. The comparable value is an INTEGER number of basis points, never a
 *      float. Floats are fine for display. They are not fine for deciding
 *      whether a threshold was crossed, because 0.7310000000000001 and 0.731
 *      disagree at the boundary. Every threshold comparison in every
 *      implementation runs on the integer returned by `ltvBps`, and every
 *      implementation rounds the same way (half away from zero, matching
 *      Rust's `f64::round`).
 *
 *   2. Scale by BPS BEFORE dividing, never after. `(debt / value) * BPS`
 *      rounds twice and loses the boundary: a position whose true ratio is
 *      exactly 7000.5 bps comes back as 7000.499999999999 and rounds down to
 *      7000 instead of up to 7001. `(debt * BPS) / value` rounds once and
 *      lands on 7000.5. There is a vector pinning this case.
 *
 * All four implementations are checked against the shared vectors in
 * `vectors.json`. Adding a case there is how you extend the contract.
 */

/** Basis points. 10_000 bps = 100%. */
export const BPS = 10_000;

/**
 * The cross-implementation contract, on exact integer values.
 *
 * This is the function the shared vectors in `../../../program/vectors/ltv-bps.json`
 * pin, and the one the on-chain program implements (`program/.../math.rs::ltv_bps`).
 * Any code path that has exact values — a live position read from the obligation,
 * where KLend hands over `U68F60` fixed-point quantities — must go through here and
 * not through `ltvBps` below.
 *
 * Two rules make four implementations agree:
 *
 *   1. Scale by BPS BEFORE dividing. `(debt * BPS) / collateral` rounds once;
 *      `(debt / collateral) * BPS` rounds twice and loses the boundary.
 *   2. Truncate toward zero. It is the only rounding mode that is unambiguous at
 *      the boundary and identical across Rust integer division, BigInt and SQL.
 *
 * `collateralValue` and `debtValue` are values in one common unit; the ratio is
 * scale-invariant, so the unit itself never matters.
 *
 * The arguments are `bigint` and that is not fussiness. KLend stores these as `u128`
 * — `deposited_value_sf` and `borrow_factor_adjusted_debt_value_sf`, both `U68F60`
 * fixed-point — and a position of any real size overflows `Number.MAX_SAFE_INTEGER`
 * immediately. Reading them into a float and dividing would lose the low bits before
 * the comparison ever happened, which is precisely the class of disagreement this
 * contract exists to prevent.
 *
 * The result is NOT clamped. The program clamps to 10000 because it stores a `u16`,
 * which cannot change any decision — every trigger is at most 10000, so a true ratio
 * above 10000 is above every trigger and so is the clamped value. Off-chain we report
 * the real number, because "340%" tells a user something "100%" hides.
 */
export function ltvBpsFromValues(collateralValue: bigint, debtValue: bigint): number {
  if (collateralValue <= 0n) return debtValue > 0n ? BPS : 0;
  return Number((debtValue * BigInt(BPS)) / collateralValue);
}

/**
 * Debt value that has to be repaid to bring an exact position to `targetLtvBps`.
 * The integer counterpart of `debtToReachLtv`, matching the program's
 * `repay_value_for_target`.
 */
export function repayValueForTarget(
  collateralValue: bigint,
  debtValue: bigint,
  targetLtvBps: number,
): bigint {
  const allowedDebt = (collateralValue * BigInt(targetLtvBps)) / BigInt(BPS);
  return debtValue > allowedDebt ? debtValue - allowedDebt : 0n;
}

export interface Position {
  /** Collateral held, in whole units of the collateral token (e.g. 12.5 SOL). */
  collateral: number;
  /** Debt owed, in quote currency units (e.g. 1_400 USDC). */
  debt: number;
  /**
   * The market's liquidation threshold, in basis points. Above this LTV the
   * protocol may liquidate. This is a market parameter, not a user setting.
   */
  liquidationLtvBps: number;
}

/**
 * Rounds half away from zero, which is what Rust's `f64::round` does.
 *
 * JavaScript's `Math.round` rounds half UP, so it disagrees with Rust on
 * negative halves. None of the values here go negative today, but the watcher
 * and the program share these vectors, and a rounding mode that only works for
 * positive numbers is a trap left for later.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Value of the collateral in quote currency. */
export function collateralValue(position: Position, price: number): number {
  return position.collateral * price;
}

/**
 * Loan to value, in integer basis points, for a position priced in floating point.
 *
 * This is the SIMULATOR path, and it deliberately rounds to nearest rather than
 * truncating like `ltvBpsFromValues`. The difference is not a divergence in the
 * formula; it is a consequence of the input. `collateral * price` is a float, so a
 * ratio whose true value is 6000 arrives as 5999.9999999999995, and truncating would
 * report 5999 — a whole basis point of error invented by IEEE 754, in the direction
 * that makes the position look healthier than it is. Rounding to nearest absorbs
 * that; truncation is correct only when the inputs are exact.
 *
 * So: exact values (a live obligation) go through `ltvBpsFromValues`, which is the
 * contract shared with the program. Hypothetical values (the simulator, where the
 * user drags a price slider) go through here. Nothing compares one against the other.
 *
 * A position with no collateral has no meaningful ratio. It returns the maximum
 * rather than Infinity so that comparisons stay total and serialisation stays
 * possible. With debt outstanding that is the correct reading anyway: the
 * position is as unhealthy as a position can be.
 */
export function ltvBps(position: Position, price: number): number {
  const value = collateralValue(position, price);
  if (value <= 0) return position.debt > 0 ? BPS : 0;
  return roundHalfAwayFromZero((position.debt * BPS) / value);
}

/** Loan to value as a fraction, for display only. Never compare on this. */
export function ltv(position: Position, price: number): number {
  return ltvBps(position, price) / BPS;
}

/**
 * The collateral price at which the position reaches its liquidation
 * threshold. Returns 0 when there is no debt: such a position is never
 * liquidated, at any price.
 */
export function liquidationPrice(position: Position): number {
  if (position.debt <= 0) return 0;
  if (position.collateral <= 0) return Infinity;
  return (position.debt * BPS) / (position.collateral * position.liquidationLtvBps);
}

/**
 * How far the collateral price can fall before liquidation, as a fraction of
 * the current price. 0.35 means "a 35% drop reaches the liquidation price".
 *
 * Returns 0 when the position is already at or past the threshold.
 */
export function dropToLiquidation(position: Position, price: number): number {
  if (price <= 0) return 0;
  const trigger = liquidationPrice(position);
  if (trigger >= price) return 0;
  return (price - trigger) / price;
}

/**
 * Collateral, in whole token units, that has to be added to bring the position
 * from its current LTV down to `targetLtvBps`.
 *
 * Returns 0 when the position is already at or below the target: the rule is
 * satisfied and the agent has nothing to do.
 */
export function collateralToReachLtv(
  position: Position,
  price: number,
  targetLtvBps: number,
): number {
  if (targetLtvBps <= 0 || price <= 0) return 0;
  if (ltvBps(position, price) <= targetLtvBps) return 0;
  const requiredValue = (position.debt * BPS) / targetLtvBps;
  return (requiredValue - collateralValue(position, price)) / price;
}

/**
 * Debt, in quote currency, that has to be repaid to bring the position from its
 * current LTV down to `targetLtvBps`.
 *
 * Capped at the outstanding debt: you cannot repay more than you owe.
 */
export function debtToReachLtv(
  position: Position,
  price: number,
  targetLtvBps: number,
): number {
  if (targetLtvBps <= 0) return position.debt;
  if (ltvBps(position, price) <= targetLtvBps) return 0;
  const allowedDebt = (collateralValue(position, price) * targetLtvBps) / BPS;
  return Math.min(position.debt, position.debt - allowedDebt);
}
