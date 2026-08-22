import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ltvBpsFromValues } from "@/lib/core/ltv/calc";
import {
  decodeMarketName,
  decodeObligation,
  decodeReserve,
  fractionToBaseUnits,
  fractionToNumber,
  liquidationThresholdBps,
  toPositionSnapshot,
  type ReserveInfo,
} from "./kamino";

/**
 * The decoder against real Kamino bytes.
 *
 * These are the same mainnet accounts the Rust adapter is pinned against, committed
 * under `program/tests/litesvm-harness/fixtures`. Reading them here proves the two
 * implementations agree about the layout without either importing the other, which
 * is the only kind of agreement that survives one of them being edited.
 */

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../program/tests/litesvm-harness/fixtures",
);

function load(name: string): Uint8Array | null {
  try {
    return Uint8Array.from(
      Buffer.from(readFileSync(join(FIXTURES, name), "utf8").replace(/\s/g, ""), "base64"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const obligationBytes = load("mainnet-obligation.base64");
const reserveBytes = load("mainnet-usdc-reserve.base64");
const marketBytes = load("mainnet-lending-market.base64");

const MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_RESERVE = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";

test("fixed point converts without losing the fractional part", () => {
  // 1234.5 in U68F60, into six-decimal base units.
  const sf = (1234n << 60n) + (1n << 59n);
  assert.equal(fractionToBaseUnits(sf, 6), 1_234_500_000n);
  assert.equal(Math.round(fractionToNumber(sf) * 10) / 10, 1234.5);

  // Shifting before multiplying would return 1_234_000_000 here, which is the bug
  // this asserts against.
  assert.notEqual(fractionToBaseUnits(sf, 6), (sf >> 60n) * 1_000_000n);
});

test("zero decodes to zero rather than to something plausible", () => {
  assert.equal(fractionToBaseUnits(0n, 6), 0n);
  assert.equal(fractionToNumber(0n), 0);
});

if (reserveBytes === null || obligationBytes === null) {
  test("mainnet fixtures", { skip: `not found in ${FIXTURES}` }, () => {});
} else {
  test("the mainnet USDC reserve decodes to its published parameters", () => {
    const reserve = decodeReserve(USDC_RESERVE, reserveBytes);

    assert.equal(reserve.mint, USDC_MINT);
    assert.equal(reserve.symbol, "USDC");
    assert.equal(reserve.decimals, 6);
    // Kamino publishes the main market USDC reserve at a 90% liquidation threshold.
    assert.equal(reserve.liquidationThresholdBps, 9_000);
    // A stablecoin reserve prices near one, which is the cheapest possible check
    // that the price offset is not reading an adjacent field.
    assert.ok(
      reserve.price > 0.9 && reserve.price < 1.1,
      `USDC priced at ${reserve.price}`,
    );
    assert.ok(reserve.priceUpdatedAt > 1_600_000_000, "price timestamp looks like a date");
  });

  test("the mainnet obligation decodes to a self-consistent position", () => {
    const obligation = decodeObligation("BMRn6coHoNM2rWZuCEq3gzcx4eQu3BXrVU9vTz4DFYeg", obligationBytes);

    assert.equal(obligation.lendingMarket, MAIN_MARKET);
    assert.ok(obligation.deposits.length > 0, "the sampled position has collateral");
    assert.ok(obligation.borrows.length > 0, "the sampled position has debt");

    // KLend maintains the aggregates as the sum of the entries. Reproducing that
    // from independently decoded offsets is the strongest available evidence that
    // none of them is off.
    const deposits = obligation.deposits.reduce((sum, entry) => sum + entry.valueSf, 0n);
    const borrows = obligation.borrows.reduce((sum, entry) => sum + entry.valueSf, 0n);
    assert.equal(obligation.collateralValueSf, deposits);
    assert.equal(obligation.debtValueSf, borrows);

    // The USDC reserve of the other fixture is one of this position's collaterals.
    assert.ok(obligation.deposits.some((entry) => entry.reserve === USDC_RESERVE));
  });

  test("a snapshot taken between transactions is stale and its cached threshold is not trusted", () => {
    const obligation = decodeObligation("BMRn6coHoNM2rWZuCEq3gzcx4eQu3BXrVU9vTz4DFYeg", obligationBytes);
    assert.equal(obligation.stale, true);
    // 255 is the sentinel an un-refreshed obligation carries. Read literally it
    // would claim a 25500 bps liquidation threshold.
    assert.equal(obligation.liquidationLtvPct, 255);

    const reserves = new Map<string, ReserveInfo>([
      [USDC_RESERVE, decodeReserve(USDC_RESERVE, reserveBytes)],
    ]);
    // Derived from the reserve instead, and clamped to something real.
    const threshold = liquidationThresholdBps(obligation, reserves);
    assert.ok(threshold > 0 && threshold <= 10_000, `threshold was ${threshold}`);
  });

  test("the position snapshot keeps the decision values exact", () => {
    const obligation = decodeObligation("BMRn6coHoNM2rWZuCEq3gzcx4eQu3BXrVU9vTz4DFYeg", obligationBytes);
    const reserves = new Map<string, ReserveInfo>([
      [USDC_RESERVE, decodeReserve(USDC_RESERVE, reserveBytes)],
    ]);
    const snapshot = toPositionSnapshot(obligation, reserves, "Main Market");

    assert.equal(snapshot.obligation, "BMRn6coHoNM2rWZuCEq3gzcx4eQu3BXrVU9vTz4DFYeg");
    assert.equal(snapshot.market, "Main Market");

    // The LTV computed from the snapshot must equal the one computed from the raw
    // U68F60 aggregates: the ratio is scale invariant, so converting to base units
    // must not have moved it.
    const fromSnapshot = ltvBpsFromValues(snapshot.collateralValue, snapshot.debtValue);
    const fromRaw = ltvBpsFromValues(obligation.collateralValueSf, obligation.debtValueSf);
    assert.equal(fromSnapshot, fromRaw);

    // The sampled position is a healthy one, which is worth pinning: a decoder that
    // silently returned zeros would also pass an "is a number" assertion.
    assert.ok(fromSnapshot > 1_000 && fromSnapshot < 9_000, `LTV read as ${fromSnapshot} bps`);
  });

  test("a borrow amount is the fixed point scale removed, not the decimals applied twice", () => {
    // Regression, found against live devnet. `borrowed_amount_sf` already counts
    // base units and carries accrued interest in its fractional part; treating it
    // like a whole-token figure rendered a 13 cSOL debt as 13,366,717,578 cSOL.
    const obligation = decodeObligation("x", obligationBytes);
    const borrow = obligation.borrows[0];
    const reserves = new Map<string, ReserveInfo>([
      [
        borrow.reserve,
        { ...decodeReserve(USDC_RESERVE, reserveBytes), address: borrow.reserve, decimals: 9 },
      ],
    ]);

    const snapshot = toPositionSnapshot(obligation, reserves, "m");
    assert.equal(snapshot.debt.amount, borrow.amount >> 60n);
    assert.notEqual(snapshot.debt.amount, (borrow.amount * 10n ** 9n) >> 60n);
  });

  test("a position that has never been refreshed is flagged, not shown as empty", () => {
    const obligation = decodeObligation("x", obligationBytes);

    // KLend leaves the aggregates at zero until the first refresh, while the entries
    // already carry values. Rendering that as a position with no collateral and no
    // debt would tell somebody their borrow had vanished.
    const unrefreshed = { ...obligation, collateralValueSf: 0n, debtValueSf: 0n, stale: true };
    const snapshot = toPositionSnapshot(unrefreshed, new Map(), "m");

    assert.equal(snapshot.refreshed, false);
    assert.ok(snapshot.collateralValue > 0n, "collateral recovered from the entries");
    assert.ok(snapshot.debtValue > 0n, "debt recovered from the entries");

    // And a refreshed one reports itself as such, with the aggregates untouched.
    const fresh = toPositionSnapshot({ ...obligation, stale: false }, new Map(), "m");
    assert.equal(fresh.refreshed, true);
    assert.equal(fresh.collateralValue, snapshot.collateralValue);
  });

  test("an empty market name falls back rather than rendering blank", () => {
    const obligation = decodeObligation("BMRn6coHoNM2rWZuCEq3gzcx4eQu3BXrVU9vTz4DFYeg", obligationBytes);
    const snapshot = toPositionSnapshot(obligation, new Map(), "");
    assert.match(snapshot.market, /^Kamino /);
  });

  test("a truncated or foreign account is refused, not misread", () => {
    assert.throws(() => decodeReserve(USDC_RESERVE, reserveBytes.subarray(0, 100)), /bytes/);
    const corrupted = Uint8Array.from(obligationBytes);
    corrupted[0] ^= 0xff;
    assert.throws(() => decodeObligation("x", corrupted), /not a Kamino/);
  });
}

if (marketBytes === null) {
  test("mainnet market fixture", { skip: `not found in ${FIXTURES}` }, () => {});
} else {
  test("the lending market name is read from its own offset", () => {
    assert.equal(decodeMarketName(marketBytes), "SOL/BTC Market");
  });
}
