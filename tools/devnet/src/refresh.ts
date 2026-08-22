/**
 * Refreshes an obligation so its aggregate values are current.
 *
 * KLend recomputes an obligation only inside `refresh_obligation` and marks it stale
 * afterwards, so a position read straight after a borrow reports a debt value of
 * zero. That is not a decoding bug — the number genuinely is not on chain yet.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { KLEND_PROGRAM_ID, instructionCoder } from "./klend.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8"));
const connection = new Connection(process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.BRACE_KEYPAIR ?? join(homedir(), ".config/solana/id.json"), "utf8"))),
);
const coder = instructionCoder();
const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const ix = (name: string, keys: ReturnType<typeof ro>[]) =>
  ({ programId: KLEND_PROGRAM_ID, keys, data: coder.encode(name, {}) }) as never;

const lendingMarket = new PublicKey(market.lendingMarket);
const obligation = new PublicKey(process.argv[2]);
const account = await connection.getAccountInfo(obligation);
if (!account) throw new Error(`no obligation at ${obligation.toBase58()}`);

const at = (o: number) => new PublicKey(account.data.subarray(o, o + 32));
const used = (o: number) => !account.data.subarray(o, o + 32).every((b) => b === 0);
const reserves = [
  ...Array.from({ length: 8 }, (_, i) => 96 + i * 136).filter(used).map(at),
  ...Array.from({ length: 5 }, (_, i) => 1_208 + i * 200).filter(used).map(at),
];

const feeds = new Map([
  [market.collateral.reserve, market.collateral.pythFeed],
  [market.debt.reserve, market.debt.pythFeed],
]);

const signature = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(
    ...reserves.map((reserve) =>
      ix("refreshReserve", [
        rw(reserve),
        ro(lendingMarket),
        ro(new PublicKey(feeds.get(reserve.toBase58())!)),
        ro(KLEND_PROGRAM_ID),
        ro(KLEND_PROGRAM_ID),
        ro(KLEND_PROGRAM_ID),
      ]),
    ),
    ix("refreshObligation", [ro(lendingMarket), rw(obligation), ...reserves.map(rw)]),
  ),
  [payer],
  { commitment: "confirmed" },
);
console.log(`refreshed ${obligation.toBase58()}\n  ${signature}`);
