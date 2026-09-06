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

import { decodeObligation, type ObligationInfo } from "@/lib/platform/kamino";
import {
  borrowIx,
  associatedTokenAddress,
  createAtaIdempotent,
  depositIx,
  initObligationIx,
  initUserMetadataIx,
  obligationAddress,
  repayObligationLiquidityV2Ix,
  refreshObligationIx,
  refreshReserveIx,
  U64_MAX,
  withdrawObligationCollateralAndRedeemReserveCollateralV2Ix,
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

export interface ClosePositionPlan {
  obligation: string;
  transaction: Transaction;
}

/**
 * Reads and validates the project's own test obligation before building a close
 * transaction. The close button must never become a generic arbitrary-position
 * withdrawer just because an account happens to share an owner.
 */
async function testObligation(
  connection: Connection,
  owner: PublicKey,
): Promise<{ address: PublicKey; info: ObligationInfo }> {
  const market = new PublicKey(DEVNET_MARKET.lendingMarket);
  const address = obligationAddress(owner, market);
  const account = await connection.getAccountInfo(address);

  if (account === null) throw new Error("No test Kamino position was found for this wallet.");
  const info = decodeObligation(address.toBase58(), account.data);
  if (
    !account.owner.equals(new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD")) ||
    info.owner !== owner.toBase58() ||
    info.lendingMarket !== market.toBase58()
  ) {
    throw new Error("This is not the Brace devnet test position.");
  }

  return { address, info };
}

function assertTestPositionShape(info: ObligationInfo) {
  const collateralReserve = DEVNET_MARKET.collateral.reserve;
  const debtReserve = DEVNET_MARKET.debt.reserve;
  if (
    info.deposits.some((entry) => entry.reserve !== collateralReserve) ||
    info.borrows.some((entry) => entry.reserve !== debtReserve) ||
    info.deposits.length > 1 ||
    info.borrows.length > 1
  ) {
    throw new Error("Close test position supports only the project's single-asset test position.");
  }
}

function formatBaseUnits(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

/** Builds the first close step: repay the outstanding test debt in full. */
export async function planCloseRepay(input: {
  connection: Connection;
  owner: PublicKey;
}): Promise<ClosePositionPlan | null> {
  const market = new PublicKey(DEVNET_MARKET.lendingMarket);
  const reserve = new PublicKey(DEVNET_MARKET.debt.reserve);
  const liquidityMint = new PublicKey(DEVNET_MARKET.debt.mint);
  const { address, info } = await testObligation(input.connection, input.owner);
  assertTestPositionShape(info);
  if (info.borrows.length === 0) return null;

  const refresh = await planRefresh({ connection: input.connection, owner: input.owner });
  if (refresh === null) throw new Error("The test position has no refreshable reserves.");

  // Use Kamino's documented full-repay sentinel. It makes the program calculate the
  // final interest-bearing debt after this transaction's refresh, instead of relying
  // on the slightly older browser snapshot for the exact u64.
  const borrowedAmountSf = info.borrows[0].amount;
  const repayAmount = (borrowedAmountSf + (1n << 60n) - 1n) >> 60n;

  // The refresh is part of the transaction, so the final interest-bearing amount
  // can be a little higher than the value in the account snapshot we just read.
  // Catch the common case before Phantom opens: SPL Token reports this as the
  // unhelpful custom error 0x1 (insufficient funds).
  const debtAta = associatedTokenAddress(liquidityMint, input.owner);
  const debtAccount = await input.connection.getAccountInfo(debtAta);
  const balance = debtAccount === null ? null : await input.connection.getTokenAccountBalance(debtAta);
  const available = BigInt(balance?.value.amount ?? "0");
  if (available < repayAmount) {
    const shortfall = repayAmount - available;
    throw new Error(
      `Not enough ${DEVNET_MARKET.debt.label} to close this test position. ` +
        `Kamino interest requires at least ${formatBaseUnits(repayAmount, DEVNET_MARKET.debt.decimals)} ` +
        `but this wallet has ${formatBaseUnits(available, DEVNET_MARKET.debt.decimals)} ` +
        `(${formatBaseUnits(shortfall, DEVNET_MARKET.debt.decimals)} short). ` +
        `Top up test ${DEVNET_MARKET.debt.label} on devnet, then try again.`,
    );
  }

  const transaction = new Transaction().add(
    createAtaIdempotent(input.owner, input.owner, liquidityMint),
    ...refresh.instructions,
    repayObligationLiquidityV2Ix({
      owner: input.owner,
      obligation: address,
      market,
      reserve,
      liquidityMint,
      amount: U64_MAX,
      depositReserves: info.deposits.map((entry) => new PublicKey(entry.reserve)),
    }),
  );

  return { obligation: address.toBase58(), transaction };
}

/** Builds the second close step: return all collateral, emptying the obligation. */
export async function planCloseWithdraw(input: {
  connection: Connection;
  owner: PublicKey;
}): Promise<ClosePositionPlan | null> {
  const market = new PublicKey(DEVNET_MARKET.lendingMarket);
  const reserve = new PublicKey(DEVNET_MARKET.collateral.reserve);
  const liquidityMint = new PublicKey(DEVNET_MARKET.collateral.mint);
  const { address, info } = await testObligation(input.connection, input.owner);
  assertTestPositionShape(info);
  if (info.borrows.length > 0) throw new Error("Repay the test debt before withdrawing collateral.");
  const deposit = info.deposits[0];
  if (!deposit || deposit.amount === 0n) return null;

  const refresh = await planRefresh({ connection: input.connection, owner: input.owner });
  if (refresh === null) throw new Error("The test position has no refreshable reserves.");

  const transaction = new Transaction().add(
    createAtaIdempotent(input.owner, input.owner, liquidityMint),
    ...refresh.instructions,
    withdrawObligationCollateralAndRedeemReserveCollateralV2Ix({
      owner: input.owner,
      obligation: address,
      market,
      reserve,
      liquidityMint,
      collateralAmount: deposit.amount,
    }),
  );

  return { obligation: address.toBase58(), transaction };
}
