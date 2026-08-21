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
  | { kind: "insufficient_funds"; needed: bigint; available: bigint }
  | { kind: "rpc_unavailable"; detail?: string }
  | { kind: "price_stale"; publishedAt: number }
  | { kind: "congested"; retryable: true }
  | { kind: "authorization_expired" }
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
   * Whether this source can sign anything. False for a read-only chain source
   * pointed at a program that is not deployed, which is the current state of the
   * world and has to be said out loud rather than discovered at the wallet prompt.
   */
  readonly canWrite: boolean;

  snapshot(owner: string): Promise<Snapshot>;

  /** `init_guard`. The one thing that cannot be done in the chat. */
  authorize(input: { obligation: string; policy: Policy }): Promise<Outcome>;
  deposit(input: { obligation: string; amount: bigint }): Promise<Outcome>;
  /** `amount` of `null` withdraws the whole vault, using the program's sentinel. */
  withdraw(input: { obligation: string; amount: bigint | null }): Promise<Outcome>;
  setPaused(input: { obligation: string; paused: boolean }): Promise<Outcome>;
  /** One instruction, no arguments, no confirmation step. */
  revoke(input: { obligation: string }): Promise<Outcome>;
}
