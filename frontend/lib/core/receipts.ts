/**
 * The record of everything that has happened to a guard.
 *
 * PLATFORM.md 2.6 fixes the wording as much as the fields: "repaid 120 USDC, LTV
 * 73.10% to 64.80%" and never "we saved your position". The product executes a rule
 * the user wrote. Language that takes credit for the good outcomes has to take the
 * blame for the bad ones, and the bad ones are guaranteed to arrive.
 *
 * A failed attempt is an entry in this list like any other. Section 3.8 calls it the
 * worst case in the product and the one designs forget: the watcher tried, the
 * transaction did not land, and the user has to know now rather than find it here
 * later. This type carries it so the notification and the history agree on what
 * happened.
 */

import { percentFromBps } from "@/lib/core/format";
import { formatAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";

export type ReceiptKind =
  | "authorized"
  | "policy_updated"
  | "reserve_deposited"
  | "reserve_withdrawn"
  | "action_executed"
  | "scheduled_repay"
  | "owner_repay"
  | "action_failed"
  | "paused"
  | "resumed"
  | "revoked";

export interface Receipt {
  id: string;
  kind: ReceiptKind;
  /** Unix seconds. */
  at: number;
  /**
   * Transaction signature. `null` only for a failed action that never landed,
   * which is exactly the case the list must still show.
   */
  signature: string | null;
  /** Base units of the reserve mint, for the kinds that move money. */
  amount?: bigint;
  ltvBpsBefore?: number;
  ltvBpsAfter?: number;
  /** Anchor error code for `action_failed`, when the transaction reached the chain. */
  errorCode?: number;
  /** What went wrong, in the user's terms, for `action_failed`. */
  failure?: string;
}

function amountText(amount: bigint | undefined): string {
  if (amount === undefined) return "";
  return `${formatAmount(amount, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}`;
}

function ltvText(receipt: Receipt): string {
  if (receipt.ltvBpsBefore === undefined || receipt.ltvBpsAfter === undefined) return "";
  return ` LTV ${percentFromBps(receipt.ltvBpsBefore)} to ${percentFromBps(receipt.ltvBpsAfter)}.`;
}

/**
 * One line per receipt, in the fixed phrasing of section 2.6.
 *
 * Every sentence names the action and the amount before anything else, because a
 * list of receipts is read by scanning the left edge.
 */
export function describeReceipt(receipt: Receipt): string {
  switch (receipt.kind) {
    case "authorized":
      return "Authorization granted.";
    case "policy_updated":
      return "Rule updated.";
    case "reserve_deposited":
      return `Reserve funded with ${amountText(receipt.amount)}.`;
    case "reserve_withdrawn":
      return `Withdrew ${amountText(receipt.amount)} from the reserve.`;
    case "action_executed":
      return `Repaid ${amountText(receipt.amount)}.${ltvText(receipt)}`;
    // Named apart from the line above on purpose. "The agent repaid because your
    // position was in danger" and "the agent made the payment you scheduled" are the
    // same transaction and completely different news.
    case "scheduled_repay":
      return `Scheduled payment: repaid ${amountText(receipt.amount)}.${ltvText(receipt)}`;
    case "owner_repay":
      return `You repaid ${amountText(receipt.amount)}.${ltvText(receipt)}`;
    case "action_failed":
      return `Tried to repay ${amountText(receipt.amount)} and the transaction did not go through.`;
    case "paused":
      return "Agent paused.";
    case "resumed":
      return "Agent resumed.";
    case "revoked":
      return "Authorization revoked.";
  }
}

/** Whether this entry is one the user has to be told about, not just recorded. */
export function needsAttention(receipt: Receipt): boolean {
  return receipt.kind === "action_failed";
}

export function sortByNewest(receipts: readonly Receipt[]): Receipt[] {
  return [...receipts].sort((a, b) => b.at - a.at);
}

/** Every kind that actually moved money from the reserve to the debt. */
const REPAY_KINDS = new Set<ReceiptKind>(["action_executed", "scheduled_repay", "owner_repay"]);

/**
 * Total repaid across a list, in base units.
 *
 * Counts all three ways a repay happens. The number this feeds answers "how much of
 * this debt has the reserve paid off", and for that question it does not matter
 * which signature moved it.
 */
export function totalRepaid(receipts: readonly Receipt[]): bigint {
  return receipts.reduce(
    (sum, receipt) =>
      REPAY_KINDS.has(receipt.kind) && receipt.amount !== undefined ? sum + receipt.amount : sum,
    0n,
  );
}
