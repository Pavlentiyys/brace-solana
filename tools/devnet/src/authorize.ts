/**
 * Authorizes the guard on a position, and funds its reserve.
 *
 * The app does this with the owner's wallet; this is the same two instructions
 * driven by a local keypair, so the path can be exercised end to end before anybody
 * is asked to sign it in a browser.
 *
 *   npx tsx src/authorize.ts [triggerBps] [targetBps] [reserveTokens]
 */

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
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json");

const TRIGGER_BPS = Number(process.argv[2] ?? 5_200);
const TARGET_BPS = Number(process.argv[3] ?? 4_500);
const RESERVE_TOKENS = Number(process.argv[4] ?? 50);

const KLEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const ACTION_REPAY = 1;

const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8"));
const idl = JSON.parse(readFileSync(join(HERE, "../../../program/idl/guard.json"), "utf8")) as {
  address: string;
  instructions: { name: string; discriminator: number[] }[];
};

const GUARD_PROGRAM_ID = new PublicKey(idl.address);
const disc = (name: string) =>
  Buffer.from(idl.instructions.find((entry) => entry.name === name)!.discriminator);

const connection = new Connection(RPC, "confirmed");
const owner = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8")) as number[]),
);

const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const sig = (pubkey: PublicKey, isWritable = true) => ({ pubkey, isSigner: true, isWritable });

function pda(seed: string, program: PublicKey, ...rest: PublicKey[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...rest.map((key) => key.toBuffer())],
    program,
  )[0];
}

const lendingMarket = new PublicKey(market.lendingMarket);
const debtReserve = new PublicKey(market.debt.reserve);
const vaultMint = new PublicKey(market.debt.mint);
const agent = new PublicKey(market.agent);

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

const guard = pda("guard", GUARD_PROGRAM_ID, owner.publicKey, obligation);
const vault = pda("vault", GUARD_PROGRAM_ID, guard);

/** `PolicyParams`, in declaration order — the order is the layout. */
function policyBytes(): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.writeUInt16LE(TRIGGER_BPS, 0);
  buffer.writeUInt16LE(TARGET_BPS, 2);
  buffer.writeBigUInt64LE(BigInt(Math.round(20 * 10 ** market.debt.decimals)), 4); // per action cap
  buffer.writeUInt8(3, 12); // max actions per window
  buffer.writeUInt32LE(3_600, 13); // window seconds
  buffer.writeUInt32LE(30, 17); // cooldown seconds
  buffer.writeUInt8(ACTION_REPAY, 21);
  buffer.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3_600), 22);
  return buffer;
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

console.log(`owner       ${owner.publicKey.toBase58()}`);
console.log(`obligation  ${obligation.toBase58()}`);
console.log(`guard       ${guard.toBase58()}`);
console.log(`vault       ${vault.toBase58()}`);
console.log(`agent       ${agent.toBase58()}`);
console.log(`policy      trigger ${TRIGGER_BPS} bps, target ${TARGET_BPS} bps\n`);

if ((await connection.getAccountInfo(guard)) === null) {
  await send("init_guard", [
    {
      programId: GUARD_PROGRAM_ID,
      keys: [
        sig(owner.publicKey),
        ro(agent),
        ro(obligation),
        ro(lendingMarket),
        ro(debtReserve),
        ro(vaultMint),
        rw(guard),
        rw(vault),
        ro(TOKEN_PROGRAM_ID),
        ro(SystemProgram.programId),
      ],
      data: Buffer.concat([disc("init_guard"), agent.toBuffer(), policyBytes()]),
    } as TransactionInstruction,
  ]);
} else {
  console.log("  guard already exists, skipping init_guard");
}

const amount = BigInt(Math.round(RESERVE_TOKENS * 10 ** market.debt.decimals));
const source = getAssociatedTokenAddressSync(vaultMint, owner.publicKey, true);

const depositData = Buffer.alloc(16);
disc("deposit_reserve").copy(depositData, 0);
depositData.writeBigUInt64LE(amount, 8);

await send(`deposit_reserve ${RESERVE_TOKENS} ${market.debt.label}`, [
  createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, source, owner.publicKey, vaultMint),
  createMintToInstruction(vaultMint, source, owner.publicKey, amount),
  {
    programId: GUARD_PROGRAM_ID,
    keys: [ro(guard), sig(owner.publicKey), rw(vault), rw(source), ro(vaultMint), ro(TOKEN_PROGRAM_ID)],
    data: depositData,
  } as TransactionInstruction,
]);

const balance = await connection.getTokenAccountBalance(vault);
console.log(`\nreserve holds ${balance.value.uiAmountString} ${market.debt.label}`);
console.log(`run the watcher:  npx tsx src/watch.ts --once`);
