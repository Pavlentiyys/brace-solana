import assert from "node:assert/strict";
import test from "node:test";

import {
  collateralToReachLtv,
  debtToReachLtv,
  dropToLiquidation,
  liquidationPrice,
  ltvBps,
  type Position,
} from "./calc";
import vectors from "./vectors.json" with { type: "json" };

interface Expectation {
  ltvBps?: number;
  liquidationPrice?: number;
  dropToLiquidation?: number;
}

const { tolerance } = vectors;

function assertClose(actual: number, expected: number, what: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected}, got ${actual}`,
  );
}

for (const testCase of vectors.cases) {
  test(`ltv vector: ${testCase.name}`, () => {
    const position = testCase.position as Position;
    const expect = testCase.expect as Expectation;

    // Exact. This integer is the cross-implementation contract.
    assert.equal(ltvBps(position, testCase.price), expect.ltvBps);

    if (expect.liquidationPrice !== undefined) {
      assertClose(liquidationPrice(position), expect.liquidationPrice, "liquidationPrice");
    }
    if (expect.dropToLiquidation !== undefined) {
      assertClose(
        dropToLiquidation(position, testCase.price),
        expect.dropToLiquidation,
        "dropToLiquidation",
      );
    }
  });
}

for (const testCase of vectors.actionCases) {
  test(`action vector: ${testCase.name}`, () => {
    const position = testCase.position as Position;

    assertClose(
      collateralToReachLtv(position, testCase.price, testCase.targetLtvBps),
      testCase.expect.collateralToAdd,
      "collateralToAdd",
    );
    assertClose(
      debtToReachLtv(position, testCase.price, testCase.targetLtvBps),
      testCase.expect.debtToRepay,
      "debtToRepay",
    );
  });
}

test("an action that reaches the target actually reaches it", () => {
  // The vectors pin specific numbers. This checks the property those numbers
  // are supposed to have, which is the part that matters when someone edits
  // the formula and adjusts the vectors to match their mistake.
  const position: Position = { collateral: 10, debt: 1000, liquidationLtvBps: 8000 };
  const price = 140;
  const target = 6000;

  const added = collateralToReachLtv(position, price, target);
  assert.equal(ltvBps({ ...position, collateral: position.collateral + added }, price), target);

  const repaid = debtToReachLtv(position, price, target);
  assert.equal(ltvBps({ ...position, debt: position.debt - repaid }, price), target);
});
