import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ltvBpsFromValues, repayValueForTarget } from "./calc";

/**
 * The four-implementation contract of ТЗ section 7.
 *
 * The canonical file lives beside the program, because the program is the
 * implementation that cannot be wrong — it is the one deciding whether to spend a
 * user's money. This test makes the web app prove it reproduces the same numbers.
 *
 * `program/` and `frontend/` are separate repositories, so the file may genuinely be
 * absent in a frontend-only checkout. That case skips with an explicit message
 * rather than passing quietly: a contract test that silently disappears is worse
 * than no contract test.
 */
const VECTORS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../program/vectors/ltv-bps.json",
);

interface LtvCase {
  name: string;
  collateralValue: string;
  debtValue: string;
  ltvBps: number;
  clampedLtvBps: number;
}

interface RepayCase {
  name: string;
  collateralValue: string;
  debtValue: string;
  targetBps: number;
  repayValue: string;
}

interface Vectors {
  bps: number;
  ltvCases: LtvCase[];
  repayCases: RepayCase[];
}

function loadVectors(): Vectors | null {
  try {
    return JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as Vectors;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const vectors = loadVectors();

if (vectors === null) {
  test("shared LTV vectors", { skip: `not found at ${VECTORS_PATH}` }, () => {});
} else {
  const { bps } = vectors;

  for (const testCase of vectors.ltvCases) {
    test(`shared ltv vector: ${testCase.name}`, () => {
      const actual = ltvBpsFromValues(
        BigInt(testCase.collateralValue),
        BigInt(testCase.debtValue),
      );
      assert.equal(actual, testCase.ltvBps);
      // The program stores a u16 and clamps; we check we agree on what it clamps to.
      assert.equal(Math.min(actual, bps), testCase.clampedLtvBps);
    });
  }

  for (const testCase of vectors.repayCases) {
    test(`shared repay vector: ${testCase.name}`, () => {
      assert.equal(
        repayValueForTarget(
          BigInt(testCase.collateralValue),
          BigInt(testCase.debtValue),
          testCase.targetBps,
        ),
        BigInt(testCase.repayValue),
      );
    });
  }

  test("repaying the required value lands at or below the target", () => {
    // The vectors pin numbers; this pins the property those numbers exist to have.
    for (const testCase of vectors.repayCases) {
      const collateral = BigInt(testCase.collateralValue);
      const debt = BigInt(testCase.debtValue);
      const after = ltvBpsFromValues(collateral, debt - BigInt(testCase.repayValue));
      assert.ok(
        after <= testCase.targetBps,
        `${testCase.name}: ended at ${after} bps, target was ${testCase.targetBps}`,
      );
    }
  });
}
