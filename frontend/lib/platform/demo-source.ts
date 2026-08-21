/**
 * A guard that runs in the browser.
 *
 * The program is not deployed, so this is what the panel talks to. It is a real
 * implementation of the same interface the chain source implements, not a set of
 * fixed screenshots: the price moves, the watcher reports, the rule fires when LTV
 * reaches the trigger, the reserve goes down when it does, and every button on the
 * panel changes the state the next read returns.
 *
 * Two things make it honest rather than a demo that flatters the product.
 *
 * First, it is labelled. Every screen fed by this source says so, and receipts from
 * it carry no explorer link, because there is no transaction to link to.
 *
 * Second, it can be made to fail. PLATFORM.md 6 lists the cases the interface owes
 * the user a specific answer for and section 3.8 calls a failed action the worst
 * case in the product. Those paths are the ones that never get exercised when the
 * demo data is a happy snapshot, so they are switches here and the panel carries the
 * controls for them.
 *
 * State lives in module scope and resets on reload. Persisting it would mean a
 * reviewer inheriting yesterday's revoked guard with no way back.
 */

import { positionLtvBps, repayValueToTarget, type PositionSnapshot } from "@/lib/core/position";
import { authorityIsLive, cooldownRemaining, windowUsage, type Guard } from "@/lib/core/guard";
import { validatePolicy } from "@/lib/core/policy";
import type { Receipt } from "@/lib/core/receipts";
import { quote } from "@/lib/core/units";
import { guardErrorCode } from "@/lib/core/program";
import type { DiscoveredPosition, GuardSource, Outcome, Snapshot } from "@/lib/platform/types";

export const DEMO_OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const DEMO_AGENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DEMO_OBLIGATION = "GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG";
const DEMO_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const DEMO_RESERVE_ACCOUNT = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
const DEMO_VAULT = "3ByRQCbUFTHy4uAeBn2ZWNXVLzuiXH8CBAM6oPzMwFF7";
const DEMO_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEMO_GUARD_PDA = "BraceGuard1111111111111111111111111111111111";
const UNSUPPORTED_OBLIGATION = "5HcJvKrPbDDNBmzLKmSPnJTFHiZWhoDCQfV8sLRRHXAB";

/** 40 SOL against 3,700 USDC, the position the landing page models. */
const START_PRICE = 160;
const COLLATERAL_SOL = 40;
const START_DEBT = 3_700_000_000n;
const LIQUIDATION_LTV_BPS = 8_000;

/** How often the watcher reports when it is healthy. */
const WATCHER_PERIOD_SECONDS = 4;

export type DemoFault =
  | "rpc_unavailable"
  | "watcher_stalled"
  | "price_stale"
  | "action_fails"
  | "congested"
  | "wallet_rejects";

interface World {
  /** Unix seconds the world has been advanced to. */
  clock: number;
  startedAt: number;
  /** Debt value in quote base units. Falls when the agent repays. */
  debtValue: bigint;
  /** Manual price shift as a fraction, from the demo controls. */
  priceShift: number;
  reserveBalance: bigint;
  walletBalance: bigint;
  guard: Guard | null;
  receipts: Receipt[];
  watcherLastCheckAt: number | null;
  priceUpdatedAt: number;
  faults: Set<DemoFault>;
  sequence: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function freshWorld(): World {
  const clock = nowSeconds();
  return {
    clock,
    startedAt: clock,
    debtValue: START_DEBT,
    priceShift: 0,
    reserveBalance: 0n,
    walletBalance: 5_000_000_000n,
    guard: null,
    receipts: [],
    watcherLastCheckAt: null,
    priceUpdatedAt: clock,
    faults: new Set(),
    sequence: 0,
  };
}

let world = freshWorld();

/**
 * A smooth deterministic walk rather than random noise.
 *
 * Two sine waves at coprime periods look like a market without being one, and being
 * a pure function of the clock means two components rendering the same second agree.
 * Nothing here is a forecast and nothing here is historical: the price the user
 * needs to reason about is the one the demo controls set.
 */
function basePrice(elapsed: number): number {
  return START_PRICE * (1 + 0.02 * Math.sin(elapsed / 47) + 0.008 * Math.sin(elapsed / 13));
}

function priceAt(state: World): number {
  return basePrice(state.clock - state.startedAt) * (1 + state.priceShift);
}

function collateralValueAt(state: World): bigint {
  return BigInt(Math.round(priceAt(state) * COLLATERAL_SOL * 1_000_000));
}

function positionAt(state: World): PositionSnapshot {
  return {
    obligation: DEMO_OBLIGATION,
    market: "Kamino main market",
    collateral: { amount: BigInt(COLLATERAL_SOL) * 1_000_000_000n, decimals: 9, symbol: "SOL" },
    collateralPrice: priceAt(state),
    debt: quote(state.debtValue),
    collateralValue: collateralValueAt(state),
    debtValue: state.debtValue,
    liquidationLtvBps: LIQUIDATION_LTV_BPS,
    priceUpdatedAt: state.priceUpdatedAt,
  };
}

/** The second position exists to give screen 2.2 its "asset not supported" state. */
function unsupportedPosition(state: World): DiscoveredPosition {
  return {
    position: {
      obligation: UNSUPPORTED_OBLIGATION,
      market: "Kamino JLP market",
      collateral: { amount: 120_000_000_000n, decimals: 9, symbol: "JLP" },
      collateralPrice: 4.12,
      debt: { amount: 210_000_000n, decimals: 6, symbol: "USDT" },
      collateralValue: 494_400_000n,
      debtValue: 210_000_000n,
      liquidationLtvBps: 7_500,
      priceUpdatedAt: state.priceUpdatedAt,
    },
    supported: false,
    unsupportedReason:
      "The guard repays USDC borrows in the main market. This borrow is in USDT in the JLP market, so there is nothing it could do here.",
    guard: null,
  };
}

function receipt(state: World, entry: Omit<Receipt, "id" | "at" | "signature">): Receipt {
  state.sequence += 1;
  return {
    id: `demo-${state.sequence}`,
    at: state.clock,
    // No signature: nothing was submitted anywhere. The history screen shows the
    // absence rather than inventing a link that goes nowhere.
    signature: null,
    ...entry,
  };
}

/**
 * Runs the world forward to `target`.
 *
 * The watcher and the agent both live in here, on the same clock, so what the panel
 * shows about liveness is the same fact that decides whether an action happens.
 */
function advance(target: number): void {
  if (target <= world.clock) return;

  for (let tick = world.clock + 1; tick <= target; tick++) {
    world.clock = tick;

    const watcherRunning = !world.faults.has("watcher_stalled") && !world.faults.has("rpc_unavailable");
    if (watcherRunning && (world.watcherLastCheckAt === null || tick - world.watcherLastCheckAt >= WATCHER_PERIOD_SECONDS)) {
      world.watcherLastCheckAt = tick;
    }
    if (!world.faults.has("price_stale")) {
      world.priceUpdatedAt = tick;
    }

    if (!watcherRunning) continue;
    maybeAct(tick);
  }
}

function maybeAct(tick: number): void {
  const guard = world.guard;
  if (!guard || !authorityIsLive(guard, tick)) return;
  if (cooldownRemaining(guard, tick) > 0) return;
  if (windowUsage(guard, tick).exhausted) return;
  if (world.reserveBalance <= 0n) return;

  const position = positionAt(world);
  const ltv = positionLtvBps(position);
  if (ltv < guard.policy.triggerLtvBps) return;

  const wanted = repayValueToTarget(position, guard.policy.targetLtvBps);
  const amount = [wanted, guard.policy.maxActionAmount, world.reserveBalance]
    .reduce((least, candidate) => (candidate < least ? candidate : least));
  if (amount <= 0n) return;

  if (world.faults.has("action_fails")) {
    // The watcher tried and the transaction did not land. The cooldown still burns,
    // because the watcher schedules its next attempt from the attempt and not from
    // the confirmation. Nothing else about the position changes.
    world.guard = { ...guard, lastActionAt: tick };
    world.receipts.push(
      receipt(world, {
        kind: "action_failed",
        amount,
        ltvBpsBefore: ltv,
        errorCode: guardErrorCode("StaleObligation"),
        failure:
          "The obligation was refreshed by somebody else in the same slot, so the repay was rejected and rolled back.",
      }),
    );
    return;
  }

  world.debtValue -= amount;
  world.reserveBalance -= amount;

  const after = positionLtvBps(positionAt(world));
  const usage = windowUsage(guard, tick);
  world.guard = {
    ...guard,
    lastActionAt: tick,
    windowStartedAt: usage.used === 0 ? tick : guard.windowStartedAt,
    actionsInWindow: usage.used + 1,
    totalActions: guard.totalActions + 1,
    totalRepaid: guard.totalRepaid + amount,
  };
  world.receipts.push(
    receipt(world, { kind: "action_executed", amount, ltvBpsBefore: ltv, ltvBpsAfter: after }),
  );
}

function currentPositions(): DiscoveredPosition[] {
  return [
    { position: positionAt(world), supported: true, guard: world.guard },
    unsupportedPosition(world),
  ];
}

/** Applies to every write, so the fault switches cover signing as well as reading. */
function writeFault(): Outcome | null {
  if (world.faults.has("rpc_unavailable")) {
    return { ok: false, failure: { kind: "rpc_unavailable", detail: "The demo RPC switch is off." } };
  }
  if (world.faults.has("wallet_rejects")) {
    return { ok: false, failure: { kind: "wallet_rejected" } };
  }
  if (world.faults.has("congested")) {
    return { ok: false, failure: { kind: "congested", retryable: true } };
  }
  return null;
}

export const demoSource: GuardSource = {
  mode: "demo",
  canWrite: true,

  async snapshot(owner: string): Promise<Snapshot> {
    advance(nowSeconds());

    if (world.faults.has("rpc_unavailable")) {
      throw Object.assign(new Error("demo RPC is switched off"), { failureKind: "rpc_unavailable" });
    }

    return {
      now: world.clock,
      owner,
      positions: currentPositions(),
      reserveBalance: world.reserveBalance,
      walletBalance: world.walletBalance,
      watcherLastCheckAt: world.watcherLastCheckAt,
      receipts: [...world.receipts],
    };
  },

  async authorize({ policy }): Promise<Outcome> {
    advance(nowSeconds());
    const blocked = writeFault();
    if (blocked) return blocked;

    const problems = validatePolicy(policy, {
      now: world.clock,
      liquidationLtvBps: LIQUIDATION_LTV_BPS,
    });
    if (problems.length > 0) {
      return {
        ok: false,
        failure: { kind: "invalid_policy", messages: problems.map((problem) => problem.message) },
      };
    }

    world.guard = {
      address: DEMO_GUARD_PDA,
      owner: DEMO_OWNER,
      agent: DEMO_AGENT,
      obligation: DEMO_OBLIGATION,
      lendingMarket: DEMO_MARKET,
      debtReserve: DEMO_RESERVE_ACCOUNT,
      vault: DEMO_VAULT,
      vaultMint: DEMO_USDC,
      policy,
      paused: false,
      lastActionAt: 0,
      windowStartedAt: world.clock,
      actionsInWindow: 0,
      totalActions: 0,
      totalRepaid: 0n,
    };
    world.receipts.push(receipt(world, { kind: "authorized" }));
    return { ok: true, signature: null };
  },

  async deposit({ amount }): Promise<Outcome> {
    advance(nowSeconds());
    const blocked = writeFault();
    if (blocked) return blocked;

    if (amount > world.walletBalance) {
      return {
        ok: false,
        failure: { kind: "insufficient_funds", needed: amount, available: world.walletBalance },
      };
    }

    world.walletBalance -= amount;
    world.reserveBalance += amount;
    world.receipts.push(receipt(world, { kind: "reserve_deposited", amount }));
    return { ok: true, signature: null };
  },

  async withdraw({ amount }): Promise<Outcome> {
    advance(nowSeconds());
    // Deliberately not behind `writeFault`'s wallet and congestion switches beyond
    // what the chain would do: withdrawal is the exit, and the acceptance list in
    // section 7 requires it to work while paused, expired and revoked.
    if (world.faults.has("rpc_unavailable")) {
      return { ok: false, failure: { kind: "rpc_unavailable" } };
    }

    const requested = amount ?? world.reserveBalance;
    if (requested <= 0n || requested > world.reserveBalance) {
      return {
        ok: false,
        failure: { kind: "insufficient_funds", needed: requested, available: world.reserveBalance },
      };
    }

    world.reserveBalance -= requested;
    world.walletBalance += requested;
    world.receipts.push(receipt(world, { kind: "reserve_withdrawn", amount: requested }));
    return { ok: true, signature: null };
  },

  async setPaused({ paused }): Promise<Outcome> {
    advance(nowSeconds());
    const blocked = writeFault();
    if (blocked) return blocked;
    if (!world.guard) return { ok: false, failure: { kind: "unknown", detail: "no guard" } };

    world.guard = { ...world.guard, paused };
    world.receipts.push(receipt(world, { kind: paused ? "paused" : "resumed" }));
    return { ok: true, signature: null };
  },

  async revoke(): Promise<Outcome> {
    advance(nowSeconds());
    if (world.faults.has("rpc_unavailable")) {
      return { ok: false, failure: { kind: "rpc_unavailable" } };
    }
    if (!world.guard) return { ok: false, failure: { kind: "unknown", detail: "no guard" } };

    // Exactly what `revoke_handler` does: pause, expire, clear the action mask.
    world.guard = {
      ...world.guard,
      paused: true,
      policy: { ...world.guard.policy, expiresAt: world.clock, allowedActions: 0 },
    };
    world.receipts.push(receipt(world, { kind: "revoked" }));
    return { ok: true, signature: null };
  },
};

/** Switches for the demo controls on the panel. */
export const demoControls = {
  faults(): DemoFault[] {
    return [...world.faults];
  },
  setFault(fault: DemoFault, on: boolean): void {
    if (on) world.faults.add(fault);
    else world.faults.delete(fault);
  },
  /** Moves the collateral price by a fraction, cumulatively. */
  shiftPrice(fraction: number): void {
    advance(nowSeconds());
    world.priceShift = Math.max(-0.95, world.priceShift + fraction);
  },
  /** Winds the authorization clock down to test the expiry paths. */
  expireIn(seconds: number): void {
    advance(nowSeconds());
    if (!world.guard) return;
    world.guard = {
      ...world.guard,
      policy: { ...world.guard.policy, expiresAt: world.clock + seconds },
    };
  },
  reset(): void {
    world = freshWorld();
  },
};

/** Exported for tests: the position the demo starts from. */
export function demoStartingPosition(): PositionSnapshot {
  return positionAt(freshWorld());
}
