/**
 * A thin KLend client, built from the IDL rather than from the Kamino SDK.
 *
 * The SDK is a heavy tree — farms, kliquidity, scope, stake pools — and this
 * package only needs to build a handful of instructions. The IDL is the same
 * artifact the SDK generates from, so nothing is being guessed here; it is copied
 * into `idl/klend.json` and pinned. Its `version` is 1.25.0, which is the same
 * release `program/programs/guard/src/adapter/kamino.rs` pins its offsets against.
 *
 * Nothing in this file reaches the browser. The web app talks to Kamino over plain
 * JSON-RPC reads and has no Anchor dependency at all.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, BorshInstructionCoder, Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";

export const KLEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

/** Live Pyth feeds on devnet, taken from reserves that are already priced by them. */
export const PYTH_DEVNET = {
  solUsd: new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"),
  usdcUsd: new PublicKey("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"),
};

/** Account sizes, discriminator included. */
export const LENDING_MARKET_SIZE = 4_664;
export const RESERVE_SIZE = 8_624;
export const OBLIGATION_SIZE = 3_344;

const SEEDS = {
  marketAuthority: "lma",
  liquiditySupply: "reserve_liq_supply",
  feeReceiver: "fee_receiver",
  collateralMint: "reserve_coll_mint",
  collateralSupply: "reserve_coll_supply",
  userMetadata: "user_meta",
} as const;

function pda(seed: string, ...rest: PublicKey[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...rest.map((key) => key.toBuffer())],
    KLEND_PROGRAM_ID,
  )[0];
}

export function marketAuthority(market: PublicKey): PublicKey {
  return pda(SEEDS.marketAuthority, market);
}

/**
 * The four accounts `initReserve` creates for a reserve.
 *
 * Seeded by the RESERVE address alone — not by the market and mint, which is the
 * obvious guess and is wrong. `inspect.ts` checks this against reserves that
 * already exist, because getting it wrong means `initReserve` fails on chain with
 * an account mismatch and nothing that explains why.
 */
export function reserveAccounts(reserve: PublicKey) {
  return {
    liquiditySupply: pda(SEEDS.liquiditySupply, reserve),
    feeReceiver: pda(SEEDS.feeReceiver, reserve),
    collateralMint: pda(SEEDS.collateralMint, reserve),
    collateralSupply: pda(SEEDS.collateralSupply, reserve),
  };
}

export function userMetadata(owner: PublicKey): PublicKey {
  return pda(SEEDS.userMetadata, owner);
}

let cached: Program | null = null;

export function klend(connection: Connection, wallet: Keypair): Program {
  if (cached) return cached;

  const here = dirname(fileURLToPath(import.meta.url));
  const idl = JSON.parse(readFileSync(join(here, "../idl/klend.json"), "utf8")) as Idl;

  const provider = new AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: async (tx: never) => tx,
      signAllTransactions: async (txs: never[]) => txs,
    },
    { commitment: "confirmed" },
  );

  cached = new Program(idl, KLEND_PROGRAM_ID, provider);
  return cached;
}

export function instructionCoder(): BorshInstructionCoder {
  const here = dirname(fileURLToPath(import.meta.url));
  const idl = JSON.parse(readFileSync(join(here, "../idl/klend.json"), "utf8")) as Idl;
  return new BorshInstructionCoder(idl);
}

/** `UpdateConfigMode`, from the IDL. Only the ones this package sets. */
export const UpdateConfigMode = {
  UpdateLoanToValuePct: 0,
  UpdateMaxLiquidationBonusBps: 1,
  UpdateLiquidationThresholdPct: 2,
  UpdateDepositLimit: 8,
  UpdateBorrowLimit: 9,
  UpdateTokenInfoName: 16,
  UpdateTokenInfoPriceMaxAge: 17,
  UpdateTokenInfoTwapMaxAge: 18,
  UpdatePythPrice: 20,
  UpdateBorrowRateCurve: 23,
  UpdateMinLiquidationBonusBps: 30,
  UpdateBorrowFactor: 32,
  UpdateReserveStatus: 38,
  /**
   * Separate from `UpdateBorrowLimit` and defaulting to zero, which makes a fresh
   * reserve un-borrowable from any obligation that is not in an elevation group —
   * that is, from every ordinary one.
   */
  UpdateBorrowLimitOutsideElevationGroup: 44,
} as const;
