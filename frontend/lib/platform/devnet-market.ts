/**
 * The devnet Kamino market this project created, and the flow that opens a position on it.
 *
 * Every Kamino market that already existed on devnet prices its collateral in a test
 * mint controlled by somebody else, so a new borrow cannot be opened on any of them.
 * `tools/devnet` therefore creates one — a genuine KLend market with live Pyth prices
 * — where we hold the mint authority and can hand the collateral out.
 *
 * This module is the browser half: it builds the same transactions
 * `tools/devnet/src/open-position.ts` builds, but signed by the user's wallet, since
 * KLend requires the obligation owner's signature on every step and nobody can open a
 * position on somebody else's behalf.
 */

import { Connection, PublicKey, Transaction } from "@solana/web3.js";

import {
  borrowIx,
  createAtaIdempotent,
  depositIx,
  initObligationIx,
  initUserMetadataIx,
  obligationAddress,
  refreshObligationIx,
  refreshReserveIx,
  userMetadata,
} from "@/lib/platform/klend-tx";
import raw from "@/lib/platform/devnet-market.json";

export interface MarketSide {
  label: string;
  mint: string;
  decimals: number;
  reserve: string;
  pythFeed: string;
}

export interface DevnetMarket {
  cluster: string;
  lendingMarket: string;
  /**
   * The key allowed to call `execute_action`, and nothing else.
   *
   * Deliberately not the owner's: the thing watching the market cannot withdraw the
   * reserve, cannot change the policy and cannot revoke. Its secret lives in
   * `tools/devnet/agent.json` and never reaches this bundle.
   */
  agent: string;
  collateral: MarketSide;
  debt: MarketSide;
}

export const DEVNET_MARKET = raw as DevnetMarket;

/** Only offered on the cluster the market actually lives on. */
export function marketAvailableOn(cluster: string): boolean {
  return cluster === DEVNET_MARKET.cluster;
}

export interface OpenPositionPlan {
  obligation: string;
  /** Signed in order. Two, because the borrow has to see the deposit's effect. */
  transactions: Transaction[];
}

/**
 * The reserves an obligation currently references, deposits first.
 *
 * `refresh_obligation` demands exactly these and rejects any other set with
 * `InvalidAccountInput`, so they are read rather than assumed — a hardcoded list
 * works on a fresh obligation and fails on the second run.
 */
async function currentReserves(
  connection: Connection,
  obligation: PublicKey,
): Promise<PublicKey[]> {
  const account = await connection.getAccountInfo(obligation);
  if (account === null) return [];

  const data = account.data;
  const at = (offset: number) => new PublicKey(data.subarray(offset, offset + 32));
  const used = (offset: number) => !data.subarray(offset, offset + 32).every((byte) => byte === 0);

  return [
    ...Array.from({ length: 8 }, (_, index) => 96 + index * 136).filter(used).map(at),
    ...Array.from({ length: 5 }, (_, index) => 1_208 + index * 200).filter(used).map(at),
  ];
}

/**
 * Builds the two transactions that open a position.
 *
 * Split in two on purpose. The borrow has to be validated against an obligation that
 * already holds the collateral, and a single transaction would refresh against the
 * state before the deposit landed.
 */
export async function planOpenPosition(input: {
  connection: Connection;
  owner: PublicKey;
  collateralTokens: number;
  borrowTokens: number;
}): Promise<OpenPositionPlan> {
  const market = new PublicKey(DEVNET_MARKET.lendingMarket);
  const collateralReserve = new PublicKey(DEVNET_MARKET.collateral.reserve);
  const debtReserve = new PublicKey(DEVNET_MARKET.debt.reserve);
  const collateralMint = new PublicKey(DEVNET_MARKET.collateral.mint);
  const debtMint = new PublicKey(DEVNET_MARKET.debt.mint);
  const collateralFeed = new PublicKey(DEVNET_MARKET.collateral.pythFeed);
  const debtFeed = new PublicKey(DEVNET_MARKET.debt.pythFeed);

  const obligation = obligationAddress(input.owner, market);
  const collateralAmount = BigInt(
    Math.round(input.collateralTokens * 10 ** DEVNET_MARKET.collateral.decimals),
  );
  const borrowAmount = BigInt(Math.round(input.borrowTokens * 10 ** DEVNET_MARKET.debt.decimals));

  const [metadataAccount, obligationAccount, reserves] = await Promise.all([
    input.connection.getAccountInfo(userMetadata(input.owner)),
    input.connection.getAccountInfo(obligation),
    currentReserves(input.connection, obligation),
  ]);

  const first = new Transaction();
  if (metadataAccount === null) first.add(initUserMetadataIx(input.owner));
  if (obligationAccount === null) first.add(initObligationIx(input.owner, market));
  first.add(
    refreshReserveIx(collateralReserve, market, collateralFeed),
    refreshObligationIx(obligation, market, reserves),
    depositIx({
      owner: input.owner,
      market,
      reserve: collateralReserve,
      liquidityMint: collateralMint,
      amount: collateralAmount,
    }),
  );

  // The deposit has landed by the time this is signed, so the collateral reserve is
  // in the obligation and has to be listed.
  const afterDeposit = reserves.some((reserve) => reserve.equals(collateralReserve))
    ? reserves
    : [...reserves, collateralReserve];

  const second = new Transaction().add(
    createAtaIdempotent(input.owner, input.owner, debtMint),
    refreshReserveIx(collateralReserve, market, collateralFeed),
    refreshReserveIx(debtReserve, market, debtFeed),
    refreshObligationIx(obligation, market, afterDeposit),
    borrowIx({
      owner: input.owner,
      market,
      reserve: debtReserve,
      liquidityMint: debtMint,
      amount: borrowAmount,
    }),
  );

  return { obligation: obligation.toBase58(), transactions: [first, second] };
}

/**
 * Refreshes an obligation so its aggregate values are current.
 *
 * KLend recomputes them only inside `refresh_obligation` and marks the account stale
 * afterwards, so a position read straight after a borrow honestly reports a debt
 * value of zero. Sending this makes the panel show the real number.
 */
export async function planRefresh(input: {
  connection: Connection;
  owner: PublicKey;
}): Promise<Transaction | null> {
  const market = new PublicKey(DEVNET_MARKET.lendingMarket);
  const obligation = obligationAddress(input.owner, market);
  const reserves = await currentReserves(input.connection, obligation);
  if (reserves.length === 0) return null;

  const feeds = new Map([
    [DEVNET_MARKET.collateral.reserve, DEVNET_MARKET.collateral.pythFeed],
    [DEVNET_MARKET.debt.reserve, DEVNET_MARKET.debt.pythFeed],
  ]);

  const transaction = new Transaction();
  for (const reserve of reserves) {
    const feed = feeds.get(reserve.toBase58());
    if (feed) transaction.add(refreshReserveIx(reserve, market, new PublicKey(feed)));
  }
  transaction.add(refreshObligationIx(obligation, market, reserves));
  return transaction;
}
