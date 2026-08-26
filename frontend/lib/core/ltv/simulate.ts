/**
 * Replays a price series against a rule, twice: once with the agent acting and
 * once with nobody acting. The two branches start from the same capital so the
 * comparison at the end is honest.
 *
 * Scenarios built on this are labelled as example data in the interface.
 *
 * This file used to close the whole position on liquidation and claim that the
 * simplification "makes the agent look worse, never better". That was backwards.
 * A full close only ever hit the branch with no agent, so it deleted that
 * branch's recovery and inflated the agent's apparent gain — by 78% in the
 * scenario the landing page leads with. Liquidation is now partial, at Kamino's
 * close factor, and the position keeps trading afterwards.
 *
 * Remaining simplifications, and which way each one leans:
 *
 *   - The price series is the only input. No slippage, no oracle lag, no failed
 *     transactions. Favours the agent, which never misses a fill; the failure
 *     paths are a product concern (PLATFORM.md 3.8), not something to bury
 *     inside an average.
 *   - Interest does not accrue. Neutral over the hours these scenarios cover.
 *   - Liquidators arrive the moment the position is unhealthy. Favours the
 *     no-agent branch slightly, since a real one can drift past the threshold
 *     before anyone acts.
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
  /**
   * Most of the debt one liquidation may repay, in basis points. Kamino's
   * default is 2,500: a liquidator clears at most a quarter of the debt per
   * round, and the borrower keeps the rest of the position.
   */
  closeFactorBps: number;
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
  /**
   * The reserve spent on the debt at the start instead of parked for the agent,
   * then nobody acts again.
   *
   * Without it the comparison is against a borrower who leaves money idle beside
   * a loan they are worried about, which nobody does. This is what that money
   * does if you simply use it, and it is the honest thing for the agent to be
   * measured against.
   */
  reservePrepaid: Branch;
  liquidationPriceAtStart: number;
}

/** Equity is collateral value minus debt, plus whatever reserve is left over. */
function equity(position: Position, price: number, reserve: number): number {
  return collateralValue(position, price) - position.debt + reserve;
}

/**
 * One liquidation round: a liquidator repays up to the close factor and takes
 * collateral worth that repayment plus the penalty. The rest of the position
 * stays open and stays the borrower's.
 */
function liquidate(position: Position, price: number, market: MarketParams): Position {
  const repaid = Math.min(position.debt, (position.debt * market.closeFactorBps) / BPS);
  const owed = (repaid * (BPS + market.liquidationPenaltyBps)) / BPS;
  const seized = Math.min(position.collateral, owed / price);
  return {
    ...position,
    collateral: position.collateral - seized,
    debt: position.debt - repaid,
  };
}

/**
 * A liquidator can come back in the next block, so several rounds can land on
 * one price. The bound is a stop, not a model: a position far enough underwater
 * that seizing collateral raises its LTV would otherwise never converge.
 */
const MAX_LIQUIDATION_ROUNDS = 8;

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

    // No freeze after a liquidation. A partial close leaves a position that
    // keeps moving with the price, and an agent with reserve left keeps acting
    // on it.
    if (position.debt <= 0 || position.collateral <= 0) {
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

    let rounds = 0;
    while (
      position.debt > 0 &&
      position.collateral > 0 &&
      ltvBps(position, price) >= position.liquidationLtvBps &&
      rounds < MAX_LIQUIDATION_ROUNDS
    ) {
      position = liquidate(position, price, market);
      // The first one is what the interface marks. Later rounds are the same
      // event continuing, not new ones.
      if (liquidatedAt === null) liquidatedAt = i;
      rounds += 1;
    }

    ltvSeries.push(
      position.debt > 0 && position.collateral > 0 ? ltvBps(position, price) : null,
    );
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
  // Anything the reserve cannot repay stays a reserve, so the three branches
  // still start from the same capital and the comparison stays honest.
  const applied = Math.min(input.reserve, input.position.debt);

  return {
    prices: input.prices,
    withAgent: runBranch(input, true),
    withoutAgent: runBranch(input, false),
    reservePrepaid: runBranch(
      {
        ...input,
        position: { ...input.position, debt: input.position.debt - applied },
        reserve: input.reserve - applied,
        rule: { steps: [], cooldown: input.rule.cooldown },
      },
      false,
    ),
    liquidationPriceAtStart:
      (input.position.debt * BPS) /
      (input.position.collateral * input.position.liquidationLtvBps),
  };
}
