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

test("nulls appear only after liquidation, never before", () => {
  for (const scenario of SCENARIOS) {
    const result = run(scenario.prices);
    for (const branch of [result.withAgent, result.withoutAgent]) {
      const firstNull = branch.ltvBps.findIndex((v) => v === null);
      if (firstNull === -1) {
        assert.equal(branch.liquidatedAt, null);
        continue;
      }
      assert.equal(firstNull, (branch.liquidatedAt ?? -1) + 1);
      // Once the position is gone it stays gone.
      assert.ok(branch.ltvBps.slice(firstNull).every((v) => v === null));
    }
  }
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
