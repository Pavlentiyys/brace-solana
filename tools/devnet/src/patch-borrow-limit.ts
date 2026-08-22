/**
 * Opens the debt reserve to ordinary obligations.
 *
 * `borrow_limit_outside_elevation_group` is a second cap, separate from
 * `borrow_limit`, and it defaults to zero. A vanilla obligation has no elevation
 * group, so until this is raised every borrow fails with `BorrowLimitExceeded` and a
 * log line reading "Left: 0" — the limit, not the amount.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import { KLEND_PROGRAM_ID, UpdateConfigMode, instructionCoder } from "./klend.js";

const RPC = process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json");
const HERE = dirname(fileURLToPath(import.meta.url));

const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8")) as {
  lendingMarket: string;
  debt: { label: string; reserve: string };
};

const GLOBAL_CONFIG = PublicKey.findProgramAddressSync(
  [Buffer.from("global_config")],
  KLEND_PROGRAM_ID,
)[0];

const coder = instructionCoder();
const connection = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8")) as number[]),
);

const value = Buffer.alloc(8);
value.writeBigUInt64LE(1_000_000_000_000_000n);

const instruction = {
  programId: KLEND_PROGRAM_ID,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(market.lendingMarket), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(market.debt.reserve), isSigner: false, isWritable: true },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: coder.encode("updateReserveConfig", {
    mode: { updateBorrowLimitOutsideElevationGroup: {} },
    value,
    // The reserve holds deposits now, so it is past predeposit and the skip is no
    // longer allowed. Full validation is correct here anyway: the config is complete.
    skipConfigIntegrityValidation: false,
  }),
} as TransactionInstruction;

const signature = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(instruction),
  [payer],
  { commitment: "confirmed" },
);
console.log(`opened ${market.debt.label} to ordinary obligations\n  ${signature}`);
