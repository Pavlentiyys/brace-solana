/**
 * Reading Kamino (KLend) positions over JSON-RPC.
 *
 * This is the `MarketReader` `chain-source` was written around, and it is what makes
 * the app able to watch a real borrow before the guard exists. Tracking a position
 * needs nothing deployed; only acting on one does.
 *
 * The offsets below mirror `program/programs/guard/src/adapter/kamino.rs` and are
 * verified the same way: against the committed mainnet fixtures and against live
 * devnet accounts. They are duplicated rather than shared because Rust and
 * TypeScript do not share a compiler, and `kamino.test.ts` pins them.
 *
 * Every `_sf` field is a KLend `Fraction`, `U68F60` — a `u128` with 60 fractional
 * bits. Nothing here converts one to a float before comparing it: the two values the
 * LTV decision runs on stay integers all the way to `ltvBpsFromValues`.
 */

import type { PositionSnapshot } from "@/lib/core/position";
import { QUOTE_DECIMALS, type TokenAmount } from "@/lib/core/units";
import { shortenAddress } from "@/lib/core/tx/base58";

export const KLEND_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

export const OBLIGATION_SIZE = 3_344;
export const RESERVE_SIZE = 8_624;
export const LENDING_MARKET_SIZE = 4_664;

export const OBLIGATION_DISCRIMINATOR = [168, 206, 141, 106, 88, 76, 172, 167];
export const RESERVE_DISCRIMINATOR = [43, 242, 204, 202, 26, 247, 59, 127];

/** 60 fractional bits, from KLend's `Fraction = U68F60`. */
export const FRACTIONAL_BITS = 60n;

// --- Obligation ---------------------------------------------------------------
const O_STALE = 24;
const O_LENDING_MARKET = 32;
export const O_OWNER = 64;
const O_DEPOSITS = 96;
const O_DEPOSIT_STRIDE = 136;
const O_DEPOSIT_AMOUNT = 32;
const O_DEPOSIT_MARKET_VALUE = 40;
const O_LIQUIDATION_LTV = 1_184;
const O_DEPOSITED_VALUE = 1_192;
const O_BORROWS = 1_208;
const O_BORROW_STRIDE = 200;
const O_BORROWED_AMOUNT = 88;
const O_BORROW_ADJUSTED_VALUE = 120;
const O_DEBT_VALUE = 2_208;
const MAX_DEPOSITS = 8;
const MAX_BORROWS = 5;

// --- Reserve ------------------------------------------------------------------
const R_LIQUIDITY = 128;
const R_MINT = R_LIQUIDITY;
const R_MARKET_PRICE = R_LIQUIDITY + 120;
const R_PRICE_UPDATED_AT = R_LIQUIDITY + 136;
const R_MINT_DECIMALS = R_LIQUIDITY + 144;
const R_CONFIG = 4_856;
const R_LIQUIDATION_THRESHOLD_PCT = R_CONFIG + 17;
/** `config.token_info.name`, a NUL-padded ASCII label such as "USDC". */
const R_TOKEN_NAME = 5_032;
const NAME_LENGTH = 32;

// --- LendingMarket ------------------------------------------------------------
/** `name`, often empty on devnet markets, so every caller needs a fallback. */
const M_NAME = 3_248;

function u64(data: Uint8Array, offset: number): bigint {
  return view(data).getBigUint64(offset, true);
}

function u128(data: Uint8Array, offset: number): bigint {
  const low = view(data).getBigUint64(offset, true);
  const high = view(data).getBigUint64(offset + 8, true);
  return (high << 64n) | low;
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function isZero(data: Uint8Array, offset: number, length: number): boolean {
  for (let i = offset; i < offset + length; i++) if (data[i] !== 0) return false;
  return true;
}

function text(data: Uint8Array, offset: number): string {
  const slice = data.subarray(offset, offset + NAME_LENGTH);
  const end = slice.indexOf(0);
  return new TextDecoder()
    .decode(end === -1 ? slice : slice.subarray(0, end))
    .replace(/[^\x20-\x7e]/g, "")
    .trim();
}

/**
 * A `U68F60` value into integer base units of a mint.
 *
 * Shifting after multiplying, never before: `sf >> 60` first would throw away the
 * fractional part that the decimals are supposed to carry, which for a six-decimal
 * quote is the difference between 1,234.567890 and 1,234.
 */
export function fractionToBaseUnits(sf: bigint, decimals: number): bigint {
  return (sf * 10n ** BigInt(decimals)) >> FRACTIONAL_BITS;
}

/** A `U68F60` value to a float. Display only — never a comparison input. */
export function fractionToNumber(sf: bigint): number {
  const whole = sf >> FRACTIONAL_BITS;
  const fraction = sf - (whole << FRACTIONAL_BITS);
  return Number(whole) + Number(fraction) / 2 ** 60;
}

export interface ReserveInfo {
  address: string;
  mint: string;
  symbol: string;
  decimals: number;
  /** Price of one whole token in the market's quote currency. */
  price: number;
  priceUpdatedAt: number;
  liquidationThresholdBps: number;
}

export function decodeReserve(address: string, data: Uint8Array): ReserveInfo {
  assertAccount(data, RESERVE_SIZE, RESERVE_DISCRIMINATOR, "reserve");
  const decimals = Number(u64(data, R_MINT_DECIMALS));
  return {
    address,
    mint: base58(data.subarray(R_MINT, R_MINT + 32)),
    symbol: text(data, R_TOKEN_NAME) || shortenAddress(base58(data.subarray(R_MINT, R_MINT + 32)), 4),
    decimals,
    price: fractionToNumber(u128(data, R_MARKET_PRICE)),
    priceUpdatedAt: Number(u64(data, R_PRICE_UPDATED_AT)),
    liquidationThresholdBps: data[R_LIQUIDATION_THRESHOLD_PCT] * 100,
  };
}

export interface ObligationEntry {
  reserve: string;
  /** Base units for a deposit; a `U68F60` amount for a borrow. */
  amount: bigint;
  /** Risk-adjusted market value, `U68F60`. */
  valueSf: bigint;
}

export interface ObligationInfo {
  address: string;
  owner: string;
  lendingMarket: string;
  stale: boolean;
  deposits: ObligationEntry[];
  borrows: ObligationEntry[];
  collateralValueSf: bigint;
  debtValueSf: bigint;
  /**
   * `lowest_reserve_deposit_liquidation_ltv`, in whole percent.
   *
   * Only meaningful right after `refresh_obligation`; a snapshot taken between
   * transactions carries whatever the last refresh left, which on mainnet is often
   * the sentinel 255 and on devnet is sometimes a figure that no longer matches the
   * reserves. Treated as a hint and recomputed from the deposit reserves below.
   */
  liquidationLtvPct: number;
}

export function decodeObligation(address: string, data: Uint8Array): ObligationInfo {
  assertAccount(data, OBLIGATION_SIZE, OBLIGATION_DISCRIMINATOR, "obligation");

  const deposits: ObligationEntry[] = [];
  for (let i = 0; i < MAX_DEPOSITS; i++) {
    const entry = O_DEPOSITS + i * O_DEPOSIT_STRIDE;
    if (isZero(data, entry, 32)) continue;
    deposits.push({
      reserve: base58(data.subarray(entry, entry + 32)),
      amount: u64(data, entry + O_DEPOSIT_AMOUNT),
      valueSf: u128(data, entry + O_DEPOSIT_MARKET_VALUE),
    });
  }

  const borrows: ObligationEntry[] = [];
  for (let i = 0; i < MAX_BORROWS; i++) {
    const entry = O_BORROWS + i * O_BORROW_STRIDE;
    if (isZero(data, entry, 32)) continue;
    borrows.push({
      reserve: base58(data.subarray(entry, entry + 32)),
      amount: u128(data, entry + O_BORROWED_AMOUNT),
      valueSf: u128(data, entry + O_BORROW_ADJUSTED_VALUE),
    });
  }

  return {
    address,
    owner: base58(data.subarray(O_OWNER, O_OWNER + 32)),
    lendingMarket: base58(data.subarray(O_LENDING_MARKET, O_LENDING_MARKET + 32)),
    stale: data[O_STALE] !== 0,
    deposits,
    borrows,
    collateralValueSf: u128(data, O_DEPOSITED_VALUE),
    debtValueSf: u128(data, O_DEBT_VALUE),
    liquidationLtvPct: Number(u64(data, O_LIQUIDATION_LTV)),
  };
}

export function decodeMarketName(data: Uint8Array): string {
  return data.length >= LENDING_MARKET_SIZE ? text(data, M_NAME) : "";
}

/**
 * The liquidation threshold that actually governs this position.
 *
 * The lowest threshold among the reserves the collateral sits in, which is how KLend
 * derives it and is conservative when the collateral is spread across assets. The
 * obligation's own cached figure is deliberately not trusted: it is only correct in
 * the slot it was refreshed in, and a stale one reading higher than the truth would
 * put the liquidation price further away than it is.
 */
export function liquidationThresholdBps(
  obligation: ObligationInfo,
  reserves: Map<string, ReserveInfo>,
): number {
  const thresholds = obligation.deposits
    .map((deposit) => reserves.get(deposit.reserve)?.liquidationThresholdBps)
    .filter((value): value is number => typeof value === "number" && value > 0);

  if (thresholds.length > 0) return Math.min(...thresholds);

  // No deposit reserve could be read. Fall back to the cached figure only when it
  // is a plausible percentage, and to zero otherwise, which the interface renders
  // as unknown rather than as a number somebody could act on.
  const cached = obligation.liquidationLtvPct * 100;
  return cached > 0 && cached <= 10_000 ? cached : 0;
}

/** The entry that dominates the position, for the one-line display summary. */
function largest(entries: ObligationEntry[]): ObligationEntry | null {
  return entries.reduce<ObligationEntry | null>(
    (best, entry) => (best === null || entry.valueSf > best.valueSf ? entry : best),
    null,
  );
}

function amountOf(
  entry: ObligationEntry | null,
  reserves: Map<string, ReserveInfo>,
  kind: "deposit" | "borrow",
): TokenAmount {
  if (entry === null) return { amount: 0n, decimals: QUOTE_DECIMALS, symbol: "" };
  const reserve = reserves.get(entry.reserve);
  const decimals = reserve?.decimals ?? QUOTE_DECIMALS;
  return {
    // `deposited_amount` is already an integer count of base units.
    // `borrowed_amount_sf` is the same count carried in `U68F60`, because interest
    // accrues into its fractional part — so it needs the scale removed and NOT the
    // decimals applied again. Applying both is how a 13 cSOL debt renders as
    // 13,366,717,578 cSOL.
    amount: kind === "deposit" ? entry.amount : entry.amount >> FRACTIONAL_BITS,
    decimals,
    symbol: reserve?.symbol ?? "",
  };
}

/**
 * Turns a decoded obligation into the shape every screen reads.
 *
 * A position can hold up to eight collaterals and five borrows; the summary shows
 * the largest of each, while the two values the LTV runs on stay the obligation's
 * own aggregates and are never rebuilt from the summary.
 */
export function toPositionSnapshot(
  obligation: ObligationInfo,
  reserves: Map<string, ReserveInfo>,
  marketName: string,
): PositionSnapshot {
  const topDeposit = largest(obligation.deposits);
  const topBorrow = largest(obligation.borrows);
  const depositReserve = topDeposit ? reserves.get(topDeposit.reserve) : undefined;

  return {
    obligation: obligation.address,
    market: marketName || `Kamino ${shortenAddress(obligation.lendingMarket, 4)}`,
    collateral: amountOf(topDeposit, reserves, "deposit"),
    collateralPrice: depositReserve?.price ?? 0,
    debt: amountOf(topBorrow, reserves, "borrow"),
    collateralValue: fractionToBaseUnits(collateralValueSf(obligation), QUOTE_DECIMALS),
    debtValue: fractionToBaseUnits(debtValueSf(obligation), QUOTE_DECIMALS),
    liquidationLtvBps: liquidationThresholdBps(obligation, reserves),
    priceUpdatedAt: depositReserve?.priceUpdatedAt ?? 0,
    refreshed: !obligation.stale,
  };
}

/**
 * The aggregates, preferring whichever KLend actually maintained.
 *
 * On a refreshed obligation the aggregate equals the sum of the entries, and
 * `kamino.test.ts` pins that against mainnet bytes. Between transactions the two can
 * disagree: devnet holds positions whose entries carry values while
 * `deposited_value_sf` is still zero from before the first refresh. Taking the
 * larger of the two keeps a real position from rendering as an empty one, and the
 * `refreshed` flag tells the interface not to present either number as current.
 */
function collateralValueSf(obligation: ObligationInfo): bigint {
  const sum = obligation.deposits.reduce((total, entry) => total + entry.valueSf, 0n);
  return sum > obligation.collateralValueSf ? sum : obligation.collateralValueSf;
}

function debtValueSf(obligation: ObligationInfo): bigint {
  const sum = obligation.borrows.reduce((total, entry) => total + entry.valueSf, 0n);
  return sum > obligation.debtValueSf ? sum : obligation.debtValueSf;
}

function assertAccount(
  data: Uint8Array,
  size: number,
  discriminator: number[],
  what: string,
): void {
  if (data.length !== size) {
    throw new Error(`Kamino ${what} is ${data.length} bytes, expected ${size}`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== discriminator[i]) {
      throw new Error(`Account ${data.length} bytes is not a Kamino ${what}`);
    }
  }
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 for a 32-byte key. Local so the decoder has no import cycle. */
function base58(bytes: Uint8Array): string {
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading++;

  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  return "1".repeat(leading) + digits.reverse().map((d) => B58[d]).join("");
}
