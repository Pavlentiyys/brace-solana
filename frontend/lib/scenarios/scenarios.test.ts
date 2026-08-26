import assert from "node:assert/strict";
import test from "node:test";

import { simulate, type SimulationResult } from "../core/ltv/simulate";
import {
  DEMO_MARKET,
  DEMO_POSITION,
  DEMO_RESERVE,
  DEMO_RULE,
  SCENARIOS,
} from "./index";

function run(prices: number[]): SimulationResult {
  return simulate({
    position: DEMO_POSITION,
    reserve: DEMO_RESERVE,
    prices,
    rule: DEMO_RULE,
    market: DEMO_MARKET,
  });
}

for (const scenario of SCENARIOS) {
  test(`scenario "${scenario.id}" produces drawable numbers`, () => {
    const result = run(scenario.prices);

    for (const [name, branch] of [
      ["withAgent", result.withAgent],
      ["withoutAgent", result.withoutAgent],
    ] as const) {
      assert.equal(branch.ltvBps.length, scenario.prices.length, `${name}: one point per price`);

      // A liquidated branch reports null from that point on, and the chart
      // breaks the line there. Any other non-finite value would silently
      // produce "NaN" inside an SVG path attribute and blank the plot.
      for (const [i, value] of branch.ltvBps.entries()) {
        if (value === null) continue;
        assert.ok(Number.isFinite(value), `${name}: point ${i} is ${value}`);
      }

      assert.ok(Number.isFinite(branch.finalEquity), `${name}: finalEquity`);
      assert.ok(branch.reserveLeft >= 0, `${name}: reserve never goes negative`);
    }

    assert.ok(Number.isFinite(result.liquidationPriceAtStart));

    // The scales are computed from the non-null values, so at least one point
    // has to survive or the chart has nothing to draw.
    const drawable = [...result.withAgent.ltvBps, ...result.withoutAgent.ltvBps].filter(
      (v) => v !== null,
    );
    assert.ok(drawable.length > 0);
  });
}

test("a position only reads as gone after it was liquidated, and stays gone", () => {
  for (const scenario of SCENARIOS) {
    const result = run(scenario.prices);
    for (const branch of [result.withAgent, result.withoutAgent, result.reservePrepaid]) {
      const firstNull = branch.ltvBps.findIndex((v) => v === null);
      if (firstNull === -1) continue;

      // Nothing else can end a position, so a null has to follow a liquidation.
      assert.ok(branch.liquidatedAt !== null, "gone without ever being liquidated");
      assert.ok(firstNull >= branch.liquidatedAt, "gone before the liquidation that ended it");
      assert.ok(branch.ltvBps.slice(firstNull).every((v) => v === null), "came back from gone");
    }
  }
});

test("liquidation is partial: being liquidated does not end the position", () => {
  // The whole point of the close factor. If every liquidation still wiped the
  // position, the no-agent branch would keep missing every recovery and the
  // agent would keep looking better than it is.
  const survivors = SCENARIOS.flatMap((scenario) => {
    const result = run(scenario.prices);
    return [result.withAgent, result.withoutAgent].filter(
      (branch) => branch.liquidatedAt !== null && branch.ltvBps.at(-1) !== null,
    );
  });

  assert.ok(survivors.length > 0, "no branch survived a liquidation in any scenario");
});

test("prepaying the reserve is measured from the same starting capital", () => {
  for (const scenario of SCENARIOS) {
    const result = run(scenario.prices);

    // It never acts, so it never pays a fee and never touches a reserve.
    assert.equal(result.reservePrepaid.actions.length, 0);
    assert.equal(result.reservePrepaid.feesPaid, 0);
    assert.ok(Number.isFinite(result.reservePrepaid.finalEquity));
  }

  // Same position, same money, so at the opening price the three branches are
  // worth the same. Any later difference is the market, not the accounting.
  const flat = new Array(6).fill(160);
  const result = run(flat);
  const cents = (n: number) => Math.round(n * 100);
  assert.equal(cents(result.reservePrepaid.finalEquity), cents(result.withoutAgent.finalEquity));
});

test("the three scenarios disagree about whether the agent helped", () => {
  // If they ever all point the same way, the simulator has stopped making the
  // argument LANDING.md asks it to make and one of them needs replacing.
  const deltas = SCENARIOS.map((scenario) => {
    const result = run(scenario.prices);
    return result.withAgent.finalEquity - result.withoutAgent.finalEquity;
  });

  assert.ok(
    deltas.some((d) => d > 0) && deltas.some((d) => d < 0),
    `expected both signs, got ${deltas.map((d) => d.toFixed(2)).join(", ")}`,
  );
});
