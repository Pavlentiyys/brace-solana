/**
 * Mints collateral to an address that is not ours to sign for.
 *
 * KLend needs the obligation owner's signature on `initObligation`, on the deposit
 * and on the borrow, so a position cannot be opened on somebody's behalf. Handing
 * them the collateral can be: we hold the mint authority, and a recipient does not
 * sign to receive tokens. The rest they do themselves, in the app, with their wallet.
 *
 *   npx tsx src/fund.ts <address> [amount]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8"));
const connection = new Connection(process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json"), "utf8"))),
);

const recipient = new PublicKey(process.argv[2]);
const tokens = Number(process.argv[3] ?? 5);
const amount = BigInt(Math.round(tokens * 10 ** market.collateral.decimals));
const mint = new PublicKey(market.collateral.mint);
const ata = getAssociatedTokenAddressSync(mint, recipient, true);

const signature = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, recipient, mint),
    createMintToInstruction(mint, ata, payer.publicKey, amount),
  ),
  [payer],
  { commitment: "confirmed" },
);

const balance = await connection.getTokenAccountBalance(ata);
console.log(`minted ${tokens} ${market.collateral.label} to ${recipient.toBase58()}`);
console.log(`  token account ${ata.toBase58()}`);
console.log(`  balance       ${balance.value.uiAmountString} ${market.collateral.label}`);
console.log(`  ${signature}`);
