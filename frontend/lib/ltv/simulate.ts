/**
 * Replays a price series against a rule, twice: once with the agent acting and
 * once with nobody acting. The two branches start from the same capital so the
 * comparison at the end is honest.
 *
 * Deliberate simplifications, all of which make the agent look WORSE or make no
 * difference, never better. Scenarios built on this are labelled as example
 * data in the interface.
 *
 *   - Liquidation closes the whole position. Real protocols close a fraction at
 *     a time, so a real liquidation is usually less punishing than this model.
 *   - The price series is the only input. No slippage, no oracle lag, no failed
 *     transactions. The failure paths are a product concern (PLATFORM.md 3.8),
 *     not something to bury inside an average.
 *   - Interest does not accrue. Over the hours these scenarios cover it is
 *     rounding error next to the price move.
 */

import {
  BPS,
  collateralToReachLtv,
  collateralValue,
  debtToReachLtv,
  ltvBps,
  type Position,
} from "./calc";

export type ActionKind = "add_collateral" | "repay_debt";

export interface RuleStep {
  /** The agent acts when LTV reaches this, in basis points. */
  triggerLtvBps: number;
  action: ActionKind;
  /** The most reserve this step may spend, in quote currency. */
  maxSpend: number;
  /** LTV the step aims to restore, in basis points. */
  targetLtvBps: number;
}

export interface Rule {
  /**
   * Ordered by trigger, lowest first. PLATFORM.md 3.3 requires at least two:
   * one rule does not cover a whole fall.
   */
  steps: RuleStep[];
  /** Minimum points between two actions. The user's rate limit. */
  cooldown: number;
}

export interface MarketParams {
  /** Extra collateral the liquidator takes, in basis points. */
  liquidationPenaltyBps: number;
  /** Network cost of one action, in quote currency. */
  feePerAction: number;
}

export interface SimulationInput {
  position: Position;
  /** Quote currency the agent is allowed to spend. */
  reserve: number;
  prices: number[];
  rule: Rule;
  market: MarketParams;
}

export interface AgentAction {
  index: number;
  price: number;
  kind: ActionKind;
  /** Reserve spent, in quote currency. */
  spent: number;
  ltvBpsBefore: number;
  ltvBpsAfter: number;
}

export interface Branch {
  /** LTV at every point, in basis points. Null once the position is gone. */
  ltvBps: (number | null)[];
  actions: AgentAction[];
  reserveLeft: number;
  feesPaid: number;
  /** Index at which the position was liquidated, or null if it survived. */
  liquidatedAt: number | null;
  /** Everything the user still owns at the last price, in quote currency. */
  finalEquity: number;
}

export interface SimulationResult {
  prices: number[];
  withAgent: Branch;
  withoutAgent: Branch;
  liquidationPriceAtStart: number;
}

/** Equity is collateral value minus debt, plus whatever reserve is left over. */
function equity(position: Position, price: number, reserve: number): number {
  return collateralValue(position, price) - position.debt + reserve;
}

/**
 * Closes the position the way a liquidator would: the debt is repaid and
 * collateral worth the debt plus the penalty is seized. What is left over stays
 * with the user.
 */
function liquidate(position: Position, price: number, penaltyBps: number): Position {
  const owed = (position.debt * (BPS + penaltyBps)) / BPS;
  const seized = Math.min(position.collateral, owed / price);
  return { ...position, collateral: position.collateral - seized, debt: 0 };
}

function runBranch(input: SimulationInput, agentActive: boolean): Branch {
  const { prices, rule, market } = input;
  let position: Position = { ...input.position };
  let reserve = input.reserve;
  let feesPaid = 0;

  const ltvSeries: (number | null)[] = [];
  const actions: AgentAction[] = [];
  let liquidatedAt: number | null = null;
  let lastActionIndex = -Infinity;

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];

    if (liquidatedAt !== null) {
      ltvSeries.push(null);
      continue;
    }

    if (agentActive && i - lastActionIndex >= rule.cooldown) {
      const current = ltvBps(position, price);

      // Highest trigger the position has reached. A fall that blows through two
      // thresholds between checks should get the response for where it landed,
      // not the response for where it passed.
      const step = [...rule.steps]
        .filter((candidate) => current >= candidate.triggerLtvBps)
        .sort((a, b) => b.triggerLtvBps - a.triggerLtvBps)[0];

      if (step) {
        const affordable = Math.min(step.maxSpend, reserve - market.feePerAction);

        if (affordable > 0) {
          let spent = 0;
          const next: Position = { ...position };

          if (step.action === "add_collateral") {
            const wanted = collateralToReachLtv(position, price, step.targetLtvBps) * price;
            spent = Math.min(wanted, affordable);
            next.collateral += spent / price;
          } else {
            const wanted = debtToReachLtv(position, price, step.targetLtvBps);
            spent = Math.min(wanted, affordable);
            next.debt -= spent;
          }

          if (spent > 0) {
            reserve -= spent + market.feePerAction;
            feesPaid += market.feePerAction;
            actions.push({
              index: i,
              price,
              kind: step.action,
              spent,
              ltvBpsBefore: current,
              ltvBpsAfter: ltvBps(next, price),
            });
            position = next;
            lastActionIndex = i;
          }
        }
      }
    }

    const current = ltvBps(position, price);

    if (current >= position.liquidationLtvBps && position.debt > 0) {
      position = liquidate(position, price, market.liquidationPenaltyBps);
      liquidatedAt = i;
      ltvSeries.push(current);
      continue;
    }

    ltvSeries.push(current);
  }

  return {
    ltvBps: ltvSeries,
    actions,
    reserveLeft: reserve,
    feesPaid,
    liquidatedAt,
    finalEquity: equity(position, prices[prices.length - 1], reserve),
  };
}

export function simulate(input: SimulationInput): SimulationResult {
  return {
    prices: input.prices,
    withAgent: runBranch(input, true),
    withoutAgent: runBranch(input, false),
    liquidationPriceAtStart:
      (input.position.debt * BPS) /
      (input.position.collateral * input.position.liquidationLtvBps),
  };
}
