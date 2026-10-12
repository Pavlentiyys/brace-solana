/**
 * Display formatting. Every number the user reads passes through here so that
 * the same value never appears as "62%" in one place and "62.00%" in another.
 */

import { BPS } from "@/lib/core/ltv/calc";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export function money(value: number): string {
  return usd.format(value);
}

export function moneyWhole(value: number): string {
  return usdWhole.format(value);
}

/** For amounts under a cent, where `money` would round to $0.00. */
export function moneyPrecise(value: number): string {
  return value > 0 && value < 0.01 ? usdPrecise.format(value) : usd.format(value);
}

/** Signed, for differences. A leading plus makes the direction unmissable. */
export function moneySigned(value: number): string {
  const formatted = usd.format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

/** Basis points to a percentage string, always two decimals. */
export function percentFromBps(bps: number): string {
  return `${(bps / (BPS / 100)).toFixed(2)}%`;
}

export function tokens(value: number, symbol = "SOL"): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`;
}

const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const dayMonthYearShort = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dayMonthTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * "19 November 2026", from unix seconds.
 *
 * PLATFORM.md 2.3 requires the end of an authorization to be shown as a date rather
 * than a duration, so this is the format that carries it. In the reader's own
 * timezone: a date they cannot compare against their own calendar is not the point.
 */
export function calendarDate(unixSeconds: number): string {
  return dayMonthYear.format(unixSeconds * 1_000);
}

/** "19 Nov 2026". The same date where a column is too narrow for the month. */
export function calendarDateShort(unixSeconds: number): string {
  return dayMonthYearShort.format(unixSeconds * 1_000);
}

/** "19 Nov 2026, 14:03". For receipts, where the time of day matters. */
export function calendarDateTime(unixSeconds: number): string {
  return dayMonthTime.format(unixSeconds * 1_000);
}

/** Point index to elapsed time, for the simulator's time axis. */
export function elapsed(index: number, stepMinutes: number): string {
  const minutes = index * stepMinutes;
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
