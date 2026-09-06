/**
 * Mints one of the project's devnet test tokens to an address.
 *
 * The market creator keypair is the mint authority and never belongs in the web
 * bundle. This is intentionally a local/devnet tool, not a browser faucet.
 *
 *   npx tsx src/mint-to.ts <address> [amount] [collateral|debt]
 *
 * The default remains collateral for compatibility with the original faucet flow.
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
const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8")) as {
  collateral: { label: string; mint: string; decimals: number };
  debt: { label: string; mint: string; decimals: number };
};
const connection = new Connection(process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      readFileSync(process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json"), "utf8"),
    ) as number[],
  ),
);

const recipient = new PublicKey(process.argv[2]);
const tokens = Number(process.argv[3] ?? 5);
const sideName = process.argv[4] ?? "collateral";
const side = sideName === "debt" ? market.debt : sideName === "collateral" ? market.collateral : null;
if (side === null) throw new Error(`Unknown token side: ${sideName}. Use collateral or debt.`);
if (!Number.isFinite(tokens) || tokens <= 0) throw new Error("Amount must be a positive number.");

const amount = BigInt(Math.round(tokens * 10 ** side.decimals));
const mint = new PublicKey(side.mint);
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
console.log(`minted ${tokens} ${side.label} to ${recipient.toBase58()}`);
console.log(`  token account ${ata.toBase58()}`);
console.log(`  balance       ${balance.value.uiAmountString} ${side.label}`);
console.log(`  ${signature}`);
