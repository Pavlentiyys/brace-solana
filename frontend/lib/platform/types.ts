/**
 * The seam between the screens and wherever the data comes from.
 *
 * One interface, two implementations. `demo-source` is a world that runs in the
 * browser and is labelled as such everywhere it is shown. `chain-source` reads real
 * accounts over JSON-RPC. Screens never learn which one they are talking to, so the
 * day the program is deployed is a configuration change and not a rewrite.
 *
 * The failure type is the other half of the seam. PLATFORM.md 6 lists the cases the
 * interface owes the user a specific answer for, and they are enumerated here rather
 * than left as a string, so a screen that forgets one does not compile.
 */

import type { Guard } from "@/lib/core/guard";
import type { Policy } from "@/lib/core/policy";
import type { PositionSnapshot } from "@/lib/core/position";
import type { Receipt } from "@/lib/core/receipts";

export type PlatformMode = "demo" | "chain";

/** A borrow the user holds, with whatever the guard can or cannot do about it. */
export interface DiscoveredPosition {
  position: PositionSnapshot;
  /**
   * False when the market or the debt asset is outside what the program supports.
   * PLATFORM.md 2.2 requires this state to be shown as its own answer rather than
   * folded into "no positions found".
   */
  supported: boolean;
  /** Why it is unsupported, in the user's terms. */
  unsupportedReason?: string;
  /** The guard for this position, or null when there is no authorization yet. */
  guard: Guard | null;
  /**
   * True when an authorization exists but was written by a previous program and is
   * shorter than this reader expects.
   *
   * `guard` is null in that case, which on its own would read as "no authorization"
   * and lead the user to grant one at an address that is already occupied. That
   * transaction fails inside the wallet's simulation and arrives as "unexpected
   * error", which is the one failure this field exists to prevent.
   */
  guardNeedsMigration?: boolean;
}

export interface Snapshot {
  /** Unix seconds, from the source rather than the browser clock. */
  now: number;
  owner: string;
  positions: DiscoveredPosition[];
  /** Reserve balance for the selected guard, in base units of its vault mint. */
  reserveBalance: bigint;
  /** The owner's spendable balance of the reserve mint, for the deposit form. */
  walletBalance: bigint;
  /**
   * When the watcher last read the obligation. `null` means it has never reported,
   * which the panel shows as unknown rather than as healthy.
   */
  watcherLastCheckAt: number | null;
  receipts: Receipt[];
}

/**
 * Every way an operation can fail, from PLATFORM.md 6.
 *
 * `program_error` carries the on-chain code so the interface can name the actual
 * rule that stopped it instead of saying "transaction failed".
 */
export type Failure =
  | { kind: "wallet_unavailable" }
  | { kind: "wallet_rejected" }
  | { kind: "wallet_locked" }
  | { kind: "wallet_busy" }
  | { kind: "wallet_disconnected" }
  | { kind: "insufficient_funds"; needed: bigint; available: bigint }
  | { kind: "insufficient_sol"; detail?: string }
  | { kind: "rpc_unavailable"; detail?: string }
  | { kind: "rpc_rate_limited"; detail?: string }
  | { kind: "rpc_invalid_response"; method: string; detail?: string }
  | { kind: "rpc_request_failed"; method: string; code?: number; detail?: string }
  | { kind: "account_not_found"; account?: string }
  | { kind: "invalid_account_data"; account?: string; detail?: string }
  | { kind: "price_stale"; publishedAt: number }
  | { kind: "congested"; retryable: true }
  | { kind: "confirmation_timeout"; signature?: string }
  | { kind: "transaction_simulation_failed"; detail?: string }
  | { kind: "transaction_send_failed"; detail?: string }
  | { kind: "transaction_failed"; detail?: string }
  | { kind: "invalid_amount"; detail?: string }
  | { kind: "position_not_found"; detail?: string }
  | { kind: "reserve_not_found"; detail?: string }
  | { kind: "guard_not_found"; detail?: string }
  | { kind: "guard_current"; detail?: string }
  | { kind: "authorization_expired" }
  /**
   * `init_guard` was asked for a position that already has one. Anchor's `init`
   * fails on an existing PDA, and it fails during the wallet's simulation, so
   * the user meets it as a scary "unsafe transaction" prompt followed by
   * whatever generic string the wallet chose. It is a state, not an error.
   */
  | { kind: "guard_exists"; guard: string }
  | { kind: "program_error"; code: number }
  | { kind: "program_not_deployed" }
  | { kind: "invalid_policy"; messages: string[] }
  | { kind: "unknown"; detail: string };

export type Outcome =
  | { ok: true; signature: string | null }
  | { ok: false; failure: Failure };

export interface GuardSource {
  readonly mode: PlatformMode;
  /**
   * Whether this source can sign anything. False for a demo source or a chain source
   * pointed at a program that is not deployed. The UI reports that before opening a
   * wallet prompt.
   */
  readonly canWrite: boolean;

  snapshot(owner: string): Promise<Snapshot>;

  /** `init_guard`. Creates the guard, its vault, and the first rule. */
  authorize(input: { obligation: string; policy: Policy }): Promise<Outcome>;
  /**
   * `update_policy` with a whole new rule. The pause flag and the agent are kept
   * as they are; only the numbers the owner edited change.
   */
  updatePolicy(input: { obligation: string; policy: Policy }): Promise<Outcome>;
  deposit(input: { obligation: string; amount: bigint }): Promise<Outcome>;
  /** `amount` of `null` withdraws the whole vault, using the program's sentinel. */
  withdraw(input: { obligation: string; amount: bigint | null }): Promise<Outcome>;
  setPaused(input: { obligation: string; paused: boolean }): Promise<Outcome>;
  /** One instruction, no arguments, no confirmation step. */
  revoke(input: { obligation: string }): Promise<Outcome>;
  /**
   * `owner_repay`. Sends part of the reserve, or all of it, at the debt now.
   *
   * `amount` of `null` means everything in the reserve, using the program's own
   * sentinel rather than a balance read that a deposit could race. The owner signs
   * it, so it is bounded by the reserve and by nothing in the policy: pause, expiry
   * and revocation restrict the agent, never the owner's own money.
   */
  repayNow(input: { obligation: string; amount: bigint | null }): Promise<Outcome>;
  /**
   * Arms or clears the repayment schedule, leaving the rest of the rule alone.
   *
   * `update_policy` rewrites the whole record, so this reads the policy that is
   * already there and re-sends it with the schedule changed. `null` turns the
   * schedule off, which clears the grant and both numbers together because the
   * program refuses a policy carrying either half alone.
   */
  setSchedule(input: {
    obligation: string;
    schedule: { everySeconds: number; amount: bigint } | null;
  }): Promise<Outcome>;
  /** `migrate_guard`. Grows a previous-layout authorization so it can be read again. */
  migrateGuard(input: { obligation: string }): Promise<Outcome>;
}
