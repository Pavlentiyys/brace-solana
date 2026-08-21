import assert from "node:assert/strict";
import test from "node:test";

import { positionLtvBps, type PositionSnapshot } from "./position";
import { defaultPolicy, type Policy } from "./policy";
import { coverage, firingsLeft, furthestCoveredDrop, minimumForOneAction } from "./reserve";
import { quote } from "./units";

const NOW = 1_700_000_000;

/** 40 SOL at $160 against 3,700 USDC, liquidated at 80%. The landing's position. */
const POSITION: PositionSnapshot = {
  obligation: "Obligation",
  market: "Kamino main market",
  collateral: { amount: 40_000_000_000n, decimals: 9, symbol: "SOL" },
  collateralPrice: 160,
  debt: quote(3_700_000_000n),
  collateralValue: 6_400_000_000n,
  debtValue: 3_700_000_000n,
  liquidationLtvBps: 8_000,
  priceUpdatedAt: NOW,
};

const POLICY: Policy = defaultPolicy(NOW);

test("the demo position starts where the landing says it does", () => {
  assert.equal(positionLtvBps(POSITION), 5_781);
});

test("one action is sized at the trigger, not at today's price", () => {
  // The agent does not act until LTV reaches 70%, so the first action always carries
  // the position from 70% back to 62% whatever the price is when it happens.
  assert.equal(minimumForOneAction(POSITION, POLICY), 422_857_144n);
});

test("the per-action cap bounds what one action can cost", () => {
  const capped = { ...POLICY, maxActionAmount: 100_000_000n };
  assert.equal(minimumForOneAction(POSITION, capped), 100_000_000n);
});

test("a fall the rule does not reach costs nothing", () => {
  // A 5% fall leaves LTV at 60.85%, below the 70% trigger.
  const [row] = coverage(POSITION, POLICY, 0n, [0.05]);
  assert.equal(row.ruleFires, false);
  assert.equal(row.required, 0n);
  assert.equal(row.covered, true);
});

test("a 20% fall fires the rule and the cost is the repay back to target", () => {
  const [row] = coverage(POSITION, POLICY, 1_000_000_000n, [0.2]);
  assert.equal(row.ruleFires, true);
  assert.equal(row.ltvBpsAfterDrop, 7_226);
  assert.equal(row.required, 525_600_000n);
  assert.equal(row.covered, true);
  assert.equal(row.shortfall, 0n);
});

test("deeper falls cost more, monotonically", () => {
  const rows = coverage(POSITION, POLICY, 0n, [0.2, 0.3, 0.4]);
  assert.ok(rows[1].required > rows[0].required);
  assert.ok(rows[2].required > rows[1].required);
});

test("an uncovered fall reports the shortfall rather than just failing", () => {
  const [row] = coverage(POSITION, POLICY, 100_000_000n, [0.4]);
  assert.equal(row.covered, false);
  assert.equal(row.shortfall, row.required - 100_000_000n);
});

test("the covered depth is reported at whole percents", () => {
  const depth = furthestCoveredDrop(POSITION, POLICY, 525_600_000n);
  assert.equal(depth, 0.2);
});

test("a fall the rule cannot deliver is not counted as covered", () => {
  // Affordable and undeliverable at the same time: the vault holds plenty, but the
  // policy caps one action at 100 USDC and allows two per window.
  const tightRule = { ...POLICY, maxActionAmount: 100_000_000n, maxActionsPerWindow: 2 };
  const [row] = coverage(POSITION, tightRule, 10_000_000_000n, [0.3]);

  assert.equal(row.covered, true);
  assert.equal(row.withinRuleLimits, false);
  assert.equal(row.perWindowCeiling, 200_000_000n);

  // The depth is decided by the rule, not by the balance: a vault ten times the
  // debt still only reaches 17% because that is where 200 USDC per window runs out.
  assert.equal(furthestCoveredDrop(POSITION, tightRule, 10_000_000_000n), 0.17);
  assert.equal(furthestCoveredDrop(POSITION, tightRule, 100_000_000_000n), 0.17);
});

test("a fall past the liquidation threshold is flagged rather than reported as fine", () => {
  const rows = coverage(POSITION, POLICY, 10_000_000_000n, [0.2, 0.3]);
  // 20% leaves LTV at 72.26%, under the 80% threshold. 30% reaches 82.58%.
  assert.equal(rows[0].passesLiquidation, false);
  assert.equal(rows[1].passesLiquidation, true);
});

test("a reserve and a rule that handle everything report no ceiling rather than 99%", () => {
  const generous = { ...POLICY, maxActionAmount: 10_000_000_000n };
  assert.equal(furthestCoveredDrop(POSITION, generous, 100_000_000_000n), null);
});

test("firings left rounds down, which is the safe direction for a plan", () => {
  assert.equal(firingsLeft(1_000_000_000n, 422_857_144n), 2);
  assert.equal(firingsLeft(0n, 422_857_144n), 0);
  assert.equal(firingsLeft(1_000_000_000n, 0n), 0);
});
