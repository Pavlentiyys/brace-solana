/**
 * Opens a real Kamino borrow on the market this project created.
 *
 * This is the piece that makes "connect my own debt" possible at all: on the Kamino
 * markets that already exist on devnet, every usable collateral is a test mint whose
 * authority belongs to somebody else, so a new position cannot be opened there. Here
 * the mint authority is ours, so the collateral can simply be handed out.
 *
 *   npx tsx src/open-position.ts [collateral bSOL] [borrow bUSDC]
 *
 * The position belongs to the keypair that signs, because KLend requires the
 * obligation owner's signature on every step. To see it in the web app, connect that
 * same key in Phantom, or pass `BRACE_KEYPAIR` pointing at the key you use there.
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
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  KLEND_PROGRAM_ID,
  instructionCoder,
  marketAuthority,
  reserveAccounts,
  userMetadata,
} from "./klend.js";

const RPC = process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json");
const HERE = dirname(fileURLToPath(import.meta.url));

const COLLATERAL_TOKENS = Number(process.argv[2] ?? 2); // bSOL
const BORROW_TOKENS = Number(process.argv[3] ?? 100); // bUSDC

interface Side {
  label: string;
  mint: string;
  decimals: number;
  reserve: string;
  pythFeed: string;
}
interface Market {
  lendingMarket: string;
  collateral: Side;
  debt: Side;
}

const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8")) as Market;
const coder = instructionCoder();
const connection = new Connection(RPC, "confirmed");
const owner = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8")) as number[]),
);

const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const sig = (pubkey: PublicKey, isWritable = true) => ({ pubkey, isSigner: true, isWritable });

function ix(name: string, args: object, keys: ReturnType<typeof ro>[]): TransactionInstruction {
  return { programId: KLEND_PROGRAM_ID, keys, data: coder.encode(name, args) } as TransactionInstruction;
}

async function send(label: string, instructions: TransactionInstruction[]) {
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(...instructions),
    [owner],
    { commitment: "confirmed" },
  );
  console.log(`  ${label}\n    ${signature}`);
}

const lendingMarket = new PublicKey(market.lendingMarket);
const authority = marketAuthority(lendingMarket);
const collateralMint = new PublicKey(market.collateral.mint);
const debtMint = new PublicKey(market.debt.mint);
const collateralReserve = new PublicKey(market.collateral.reserve);
const debtReserve = new PublicKey(market.debt.reserve);
const collateralPdas = reserveAccounts(collateralReserve);
const debtPdas = reserveAccounts(debtReserve);

/** Vanilla obligation: tag 0, id 0, and two zeroed seeds. */
const obligation = PublicKey.findProgramAddressSync(
  [
    Buffer.from([0]),
    Buffer.from([0]),
    owner.publicKey.toBuffer(),
    lendingMarket.toBuffer(),
    PublicKey.default.toBuffer(),
    PublicKey.default.toBuffer(),
  ],
  KLEND_PROGRAM_ID,
)[0];

function refreshReserveIx(reserve: PublicKey, pyth: PublicKey) {
  // Anchor writes an absent optional account as the program's own id.
  return ix("refreshReserve", {}, [
    rw(reserve),
    ro(lendingMarket),
    ro(pyth),
    ro(KLEND_PROGRAM_ID),
    ro(KLEND_PROGRAM_ID),
    ro(KLEND_PROGRAM_ID),
  ]);
}

/** Deposit reserves first, then borrow reserves, in the obligation's own order. */
function refreshObligationIx(reserves: PublicKey[]) {
  return ix("refreshObligation", {}, [ro(lendingMarket), rw(obligation), ...reserves.map(rw)]);
}

/**
 * The reserves the obligation currently references, read off chain.
 *
 * `refreshObligation` wants exactly these, in this order, and rejects a mismatch
 * with `InvalidAccountInput`. Hardcoding the list works only on the first run; the
 * second one has a deposit already and fails, which is exactly how this was found.
 */
async function currentReserves(): Promise<PublicKey[]> {
  const account = await connection.getAccountInfo(obligation);
  if (account === null) return [];

  const data = account.data;
  const at = (offset: number) => new PublicKey(data.subarray(offset, offset + 32));
  const used = (offset: number) => !data.subarray(offset, offset + 32).every((byte) => byte === 0);

  const deposits = Array.from({ length: 8 }, (_, i) => 96 + i * 136).filter(used).map(at);
  const borrows = Array.from({ length: 5 }, (_, i) => 1_208 + i * 200).filter(used).map(at);
  return [...deposits, ...borrows];
}

const collateralAmount = BigInt(Math.round(COLLATERAL_TOKENS * 10 ** market.collateral.decimals));
const borrowAmount = BigInt(Math.round(BORROW_TOKENS * 10 ** market.debt.decimals));

console.log(`owner       ${owner.publicKey.toBase58()}`);
console.log(`market      ${lendingMarket.toBase58()}`);
console.log(`obligation  ${obligation.toBase58()}\n`);

const collateralAta = getAssociatedTokenAddressSync(collateralMint, owner.publicKey, true);
const debtAta = getAssociatedTokenAddressSync(debtMint, owner.publicKey, true);

console.log("faucet");
await send(`mint ${COLLATERAL_TOKENS} ${market.collateral.label}`, [
  createAssociatedTokenAccountIdempotentInstruction(
    owner.publicKey,
    collateralAta,
    owner.publicKey,
    collateralMint,
  ),
  createMintToInstruction(collateralMint, collateralAta, owner.publicKey, collateralAmount),
]);

if ((await connection.getAccountInfo(userMetadata(owner.publicKey))) === null) {
  console.log("\nuser metadata");
  await send("initUserMetadata", [
    ix("initUserMetadata", { userLookupTable: PublicKey.default }, [
      sig(owner.publicKey, false),
      sig(owner.publicKey),
      rw(userMetadata(owner.publicKey)),
      ro(KLEND_PROGRAM_ID),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SystemProgram.programId),
    ]),
  ]);
}

if ((await connection.getAccountInfo(obligation)) === null) {
  console.log("\nobligation");
  await send("initObligation", [
    ix("initObligation", { args: { tag: 0, id: 0 } }, [
      sig(owner.publicKey, false),
      sig(owner.publicKey),
      rw(obligation),
      ro(lendingMarket),
      ro(PublicKey.default),
      ro(PublicKey.default),
      ro(userMetadata(owner.publicKey)),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SystemProgram.programId),
    ]),
  ]);
}

console.log("\ndeposit");
await send(`deposit ${COLLATERAL_TOKENS} ${market.collateral.label} as collateral`, [
  refreshReserveIx(collateralReserve, new PublicKey(market.collateral.pythFeed)),
  refreshObligationIx(await currentReserves()),
  ix("depositReserveLiquidityAndObligationCollateral", { liquidityAmount: new BN(collateralAmount.toString()) }, [
    sig(owner.publicKey),
    rw(obligation),
    ro(lendingMarket),
    ro(authority),
    rw(collateralReserve),
    ro(collateralMint),
    rw(collateralPdas.liquiditySupply),
    rw(collateralPdas.collateralMint),
    rw(collateralPdas.collateralSupply),
    rw(collateralAta),
    ro(KLEND_PROGRAM_ID),
    ro(TOKEN_PROGRAM_ID),
    ro(TOKEN_PROGRAM_ID),
    ro(SYSVAR_INSTRUCTIONS_PUBKEY),
  ]),
]);

console.log("\nborrow");
await send(`borrow ${BORROW_TOKENS} ${market.debt.label}`, [
  createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, debtAta, owner.publicKey, debtMint),
  refreshReserveIx(collateralReserve, new PublicKey(market.collateral.pythFeed)),
  refreshReserveIx(debtReserve, new PublicKey(market.debt.pythFeed)),
  refreshObligationIx(await currentReserves()),
  ix("borrowObligationLiquidity", { liquidityAmount: new BN(borrowAmount.toString()) }, [
    sig(owner.publicKey, false),
    rw(obligation),
    ro(lendingMarket),
    ro(authority),
    rw(debtReserve),
    ro(debtMint),
    rw(debtPdas.liquiditySupply),
    rw(debtPdas.feeReceiver),
    rw(debtAta),
    ro(KLEND_PROGRAM_ID),
    ro(TOKEN_PROGRAM_ID),
    ro(SYSVAR_INSTRUCTIONS_PUBKEY),
  ]),
]);

const account = await connection.getAccountInfo(obligation);
const data = account!.data;
const q60 = (offset: number) =>
  Number(data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n)) / 2 ** 60;
const collateralValue = q60(1_192);
const debtValue = q60(2_208);

console.log("\nposition");
console.log(`  obligation  ${obligation.toBase58()}`);
console.log(`  collateral  $${collateralValue.toFixed(2)}`);
console.log(`  debt        $${debtValue.toFixed(2)}`);
console.log(
  `  LTV         ${collateralValue > 0 ? Math.floor((debtValue * 10_000) / collateralValue) : 0} bps`,
);
console.log(`\nConnect ${owner.publicKey.toBase58()} in the app to see it.`);
