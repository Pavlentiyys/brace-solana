/**
 * Token amounts, in the integer base units the chain stores.
 *
 * Nothing in this app holds a token amount as a float. USDC has six decimals, and
 * 0.1 + 0.2 is a famous enough example without doing it to somebody's collateral.
 * Amounts arrive as `bigint` base units, are formatted for display at the very last
 * step, and are parsed straight back to `bigint` from the string the user typed.
 */

/** The reserve, the debt and the risk-adjusted values are all quoted in USDC. */
export const QUOTE_DECIMALS = 6;
export const QUOTE_SYMBOL = "USDC";

export interface TokenAmount {
  /** Integer base units. */
  amount: bigint;
  decimals: number;
  symbol: string;
}

export function quote(amount: bigint): TokenAmount {
  return { amount, decimals: QUOTE_DECIMALS, symbol: QUOTE_SYMBOL };
}

const TEN = 10n;

function scale(decimals: number): bigint {
  return TEN ** BigInt(decimals);
}

/**
 * Base units to a plain number, for display and for arithmetic that is already
 * approximate (chart positions, percentages of a drop). Never for a transfer
 * amount: the amount that goes into an instruction is the `bigint`.
 */
export function toNumber(amount: bigint, decimals: number): number {
  return Number(amount) / Number(scale(decimals));
}

export function toQuoteNumber(amount: bigint): number {
  return toNumber(amount, QUOTE_DECIMALS);
}

export type ParseResult =
  | { ok: true; amount: bigint }
  | { ok: false; reason: "empty" | "not_a_number" | "negative" | "too_precise" };

/**
 * Parses what the user typed into base units, exactly.
 *
 * Digit arithmetic rather than `Number(input) * 10 ** decimals`, because the float
 * route turns "1234567.89" USDC into a value one base unit off, and the interface
 * would then send an amount that is not the one on the screen.
 *
 * More decimals than the mint has is an error rather than a rounding: silently
 * dropping the tail means the confirmation shows a different amount from the input.
 */
export function parseAmount(input: string, decimals: number): ParseResult {
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.startsWith("-")) return { ok: false, reason: "negative" };
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") return { ok: false, reason: "not_a_number" };

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return { ok: false, reason: "too_precise" };

  const padded = fraction.padEnd(decimals, "0");
  return { ok: true, amount: BigInt(whole === "" ? "0" : whole) * scale(decimals) + BigInt(padded === "" ? "0" : padded) };
}

/**
 * Base units to a decimal string, without going through a float.
 *
 * `maxFractionDigits` truncates rather than rounds, so a balance never displays as
 * more than the account holds.
 */
export function formatAmount(
  amount: bigint,
  decimals: number,
  options: { maxFractionDigits?: number; group?: boolean } = {},
): string {
  const { maxFractionDigits = 2, group = true } = options;
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;

  const divisor = scale(decimals);
  const whole = magnitude / divisor;
  const fraction = (magnitude % divisor).toString().padStart(decimals, "0").slice(0, maxFractionDigits);

  const wholeText = group ? whole.toLocaleString("en-US") : whole.toString();
  const text = maxFractionDigits > 0 ? `${wholeText}.${fraction.padEnd(maxFractionDigits, "0")}` : wholeText;
  return negative ? `-${text}` : text;
}

/** "1,204.50 USDC". The one phrasing for a token amount anywhere in the interface. */
export function formatTokenAmount(
  value: TokenAmount,
  options: { maxFractionDigits?: number } = {},
): string {
  return `${formatAmount(value.amount, value.decimals, options)} ${value.symbol}`;
}
