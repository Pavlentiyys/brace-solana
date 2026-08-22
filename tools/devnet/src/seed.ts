/**
 * Pulls prices in and funds the debt reserve, so the market can actually be borrowed from.
 *
 * `initReserve` leaves a reserve priced at zero and holding only a token seed. Two
 * things have to happen before anybody can open a position: `refreshReserve` has to
 * read the Pyth feed at least once, and the debt reserve has to hold liquidity
 * somebody can take.
 *
 * The refresh is also the moment of truth for the oracle wiring. If the Pyth feed
 * address is wrong, or the price is older than `maxAgePriceSeconds`, this is where
 * it surfaces — rather than later, inside a borrow, as an error about the position.
 */

import { BN } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  KLEND_PROGRAM_ID,
  instructionCoder,
  marketAuthority,
  reserveAccounts,
} from "./klend.js";

const RPC = process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json");
const HERE = dirname(fileURLToPath(import.meta.url));

interface Market {
  lendingMarket: string;
  collateral: { label: string; mint: string; decimals: number; reserve: string; pythFeed: string };
  debt: { label: string; mint: string; decimals: number; reserve: string; pythFeed: string };
}

const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8")) as Market;
const coder = instructionCoder();
const connection = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8")) as number[]),
);

const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });

function ix(name: string, args: object, keys: ReturnType<typeof ro>[]): TransactionInstruction {
  return { programId: KLEND_PROGRAM_ID, keys, data: coder.encode(name, args) } as TransactionInstruction;
}

/**
 * Anchor encodes an absent optional account as the program's own id, which is what
 * the three oracles we do not use have to be set to.
 */
export function refreshReserveIx(reserve: PublicKey, lendingMarket: PublicKey, pyth: PublicKey) {
  return ix("refreshReserve", {}, [
    rw(reserve),
    ro(lendingMarket),
    ro(pyth),
    ro(KLEND_PROGRAM_ID),
    ro(KLEND_PROGRAM_ID),
    ro(KLEND_PROGRAM_ID),
  ]);
}

async function send(label: string, instructions: TransactionInstruction[]) {
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(...instructions),
    [payer],
    { commitment: "confirmed" },
  );
  console.log(`  ${label}\n    ${signature}`);
}

const lendingMarket = new PublicKey(market.lendingMarket);
const authority = marketAuthority(lendingMarket);

console.log("refreshing reserves (this is where a wrong oracle would show up)");
for (const side of [market.collateral, market.debt]) {
  await send(
    `refresh ${side.label}`,
    [refreshReserveIx(new PublicKey(side.reserve), lendingMarket, new PublicKey(side.pythFeed))],
  );
}

// Liquidity for the debt side, so there is something to borrow. Deposited by us,
// not by the user: a reserve nobody has lent into cannot be borrowed from.
const DEBT_LIQUIDITY = 500_000_000n; // 500 bUSDC at six decimals
const debtReserve = new PublicKey(market.debt.reserve);
const debtMint = new PublicKey(market.debt.mint);
const debtPdas = reserveAccounts(debtReserve);
const source = getAssociatedTokenAddressSync(debtMint, payer.publicKey, true);
const destinationCollateral = getAssociatedTokenAddressSync(
  debtPdas.collateralMint,
  payer.publicKey,
  true,
);

console.log("\nfunding the debt reserve");
await send(`mint ${DEBT_LIQUIDITY} ${market.debt.label}`, [
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, source, payer.publicKey, debtMint),
  createMintToInstruction(debtMint, source, payer.publicKey, DEBT_LIQUIDITY),
]);

await send(`deposit ${DEBT_LIQUIDITY} into the reserve`, [
  createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    destinationCollateral,
    payer.publicKey,
    debtPdas.collateralMint,
  ),
  refreshReserveIx(debtReserve, lendingMarket, new PublicKey(market.debt.pythFeed)),
  // Anchor's borsh coder wants a BN for a u64, not a JS bigint.
  ix("depositReserveLiquidity", { liquidityAmount: new BN(DEBT_LIQUIDITY.toString()) }, [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    rw(debtReserve),
    ro(lendingMarket),
    ro(authority),
    ro(debtMint),
    rw(debtPdas.liquiditySupply),
    rw(debtPdas.collateralMint),
    rw(source),
    rw(destinationCollateral),
    ro(TOKEN_PROGRAM_ID),
    ro(TOKEN_PROGRAM_ID),
    ro(SYSVAR_INSTRUCTIONS_PUBKEY),
  ]),
]);

console.log("\nresult");
for (const side of [market.collateral, market.debt]) {
  const account = await connection.getAccountInfo(new PublicKey(side.reserve));
  const data = account!.data;
  const price = Number(data.readBigUInt64LE(248) + (data.readBigUInt64LE(256) << 64n)) / 2 ** 60;
  console.log(
    `  ${side.label.padEnd(6)} price $${price.toFixed(4).padStart(10)}  available ${data
      .readBigUInt64LE(224)
      .toString()
      .padStart(14)}  stale=${data[24]}`,
  );
}
