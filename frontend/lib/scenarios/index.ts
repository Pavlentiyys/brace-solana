/**
 * Three scenarios for the public simulator (LANDING.md screen 2).
 *
 * The position, the reserve and the rule are IDENTICAL across all three. Only
 * the market differs. That is the point: the same rule produces a rescue, a
 * pointless trade and a loss, and which one you get is decided by the price
 * series, not by the agent.
 *
 * The price series are shaped from real SOL drawdowns and are labelled as
 * example data everywhere they are shown. They are not tick data and they are
 * not a backtest. Anyone quoting these numbers as measured performance is
 * quoting them wrongly.
 */

import type { Position } from "@/lib/core/ltv/calc";
import type { MarketParams, Rule } from "@/lib/core/ltv/simulate";

/** 40 SOL of collateral against 3,700 USDC of debt, liquidated at 80% LTV. */
export const DEMO_POSITION: Position = {
  collateral: 40,
  debt: 3_700,
  liquidationLtvBps: 8_000,
};

/** Quote currency the agent is allowed to spend. */
export const DEMO_RESERVE = 2_200;

/**
 * Two steps, because one rule does not cover a whole fall (PLATFORM.md 3.3).
 * Top up first, then start repaying if the fall continues.
 */
export const DEMO_RULE: Rule = {
  steps: [
    { triggerLtvBps: 7_000, action: "add_collateral", maxSpend: 900, targetLtvBps: 6_200 },
    { triggerLtvBps: 7_600, action: "repay_debt", maxSpend: 1_200, targetLtvBps: 6_800 },
  ],
  cooldown: 2,
};

export const DEMO_MARKET: MarketParams = {
  // Extra collateral a liquidator takes on top of the debt.
  liquidationPenaltyBps: 500,
  // One transaction with a priority fee, in dollars.
  feePerAction: 0.0025,
};

export interface Scenario {
  id: string;
  /** Short label for the switch. */
  label: string;
  /** What the market did, in one line. */
  market: string;
  /** The real event the series is shaped from. */
  basis: string;
  /** Minutes between points, used to render the time axis. */
  stepMinutes: number;
  prices: number[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "recovery",
    label: "Fall, then recovery",
    market: "A 31% fall over twelve hours, most of it recovered within a day.",
    basis: "Shaped from SOL on 5 August 2024.",
    stepMinutes: 60,
    prices: [
      160.0, 158.2, 154.6, 149.1, 143.8, 138.4, 133.9, 129.2, 124.6, 119.3, 115.7, 112.4,
      110.2, 111.8, 114.6, 118.9, 122.4, 126.7, 130.1, 133.8, 137.2, 140.6, 143.1, 145.4,
    ],
  },
  {
    id: "wick",
    label: "Short spike down",
    market: "A 20% fall and a full recovery inside four hours.",
    basis: "Shaped from SOL on 3 February 2025.",
    stepMinutes: 20,
    prices: [
      160.0, 157.4, 152.8, 146.2, 138.6, 131.4, 128.1, 133.7, 141.2, 148.6, 153.9, 157.6,
    ],
  },
  {
    id: "no-rebound",
    label: "Fall with no rebound",
    market: "A 65% fall over thirty hours with no recovery.",
    basis: "Shaped from SOL in November 2022.",
    stepMinutes: 60,
    prices: [
      160.0, 156.8, 151.2, 144.7, 138.9, 133.2, 128.4, 122.9, 118.3, 113.6, 108.4, 104.1,
      99.7, 96.2, 92.8, 89.1, 86.4, 83.2, 80.1, 77.4, 74.6, 71.9, 69.3, 67.1, 64.8, 62.4,
      60.7, 58.9, 57.2, 55.4,
    ],
  },
];

export const DEFAULT_SCENARIO_ID = SCENARIOS[0].id;

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
