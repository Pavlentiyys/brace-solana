/**
 * The watcher: the thing that actually makes a rule fire.
 *
 * An authorized policy does nothing on its own. `execute_action` has to be called,
 * and only the agent key may call it, so something has to be reading the market and
 * submitting. That is this.
 *
 *   npx tsx src/watch.ts [--once]
 *
 * What it deliberately does not do is decide anything. It reads the guard's own
 * policy off chain, refreshes the position so the program sees current numbers, and
 * asks. Every limit — the trigger, the cooldown, the window, the per-action cap, the
 * target it must not overshoot — is enforced by the program, and this process cannot
 * talk it out of any of them. If the watcher is wrong, the transaction reverts.
 *
 * It also cannot take the money. The agent key can call one instruction, and that
 * instruction has no parameter for a destination.
 */

import { readFileSync } from "node:fs";
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

import { loadOrCreateAgent } from "./agent.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com";
const ONCE = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.BRACE_WATCH_INTERVAL_MS ?? 20_000);

const KLEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const FARMS_PROGRAM_ID = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ACTION_REPAY = 1;
const ACTION_SCHEDULED_REPAY = 1 << 2;

interface Market {
  lendingMarket: string;
  agent: string;
  collateral: { reserve: string; pythFeed: string };
  debt: { reserve: string; pythFeed: string; decimals: number; label: string };
}

const market = JSON.parse(readFileSync(join(HERE, "../market.json"), "utf8")) as Market;
const idl = JSON.parse(readFileSync(join(HERE, "../../../program/idl/guard.json"), "utf8")) as {
  address: string;
  instructions: { name: string; discriminator: number[] }[];
};

const GUARD_PROGRAM_ID = new PublicKey(idl.address);
const EXECUTE_ACTION = idl.instructions.find((entry) => entry.name === "execute_action")!.discriminator;

const connection = new Connection(RPC, "confirmed");
const agent = loadOrCreateAgent();

const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });

function pda(seed: string, program: PublicKey, ...rest: PublicKey[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...rest.map((key) => key.toBuffer())],
    program,
  )[0];
}

// --- Guard account layout, mirroring `decode.ts` and `state.rs` ----------------
//
// Everything from `expires_at` onwards shifted by 12 when the schedule fields
// landed between `allowed_actions` and it, and `last_scheduled_at` added 8 more
// after `actions_in_window`. Offsets past that point are the reason this file is
// listed beside `decode.ts` whenever the account changes: a wrong one here does not
// fail, it reads a plausible number from the wrong bytes.
const G = { owner: 8, agent: 40, obligation: 72, lendingMarket: 104, debtReserve: 136, vault: 168, vaultMint: 200 };
const G_TRIGGER = 232;
const G_TARGET = 234;
const G_MAX_ACTION = 236;
const G_ALLOWED = 253;
const G_SCHEDULE_SECONDS = 254;
const G_SCHEDULE_AMOUNT = 258;
const G_EXPIRES = 266;
const G_PAUSED = 274;
const G_LAST_SCHEDULED = 292;

// --- Obligation offsets, mirroring `adapter/kamino.rs` -------------------------
const O_STALE = 24;
const O_DEPOSITS = 96;
const O_BORROWS = 1_208;
const O_COLLATERAL_VALUE = 1_192;
const O_DEBT_VALUE = 2_208;

function key(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function u128(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
}

/** Integer basis points, truncated and clamped exactly as the program does. */
function ltvBps(collateral: bigint, debt: bigint): number {
  if (collateral === 0n) return debt > 0n ? 10_000 : 0;
  return Number((debt * 10_000n) / collateral);
}

function obligationReserves(data: Buffer): PublicKey[] {
  const used = (offset: number) => !data.subarray(offset, offset + 32).every((byte) => byte === 0);
  return [
    ...Array.from({ length: 8 }, (_, i) => O_DEPOSITS + i * 136).filter(used).map((o) => key(data, o)),
    ...Array.from({ length: 5 }, (_, i) => O_BORROWS + i * 200).filter(used).map((o) => key(data, o)),
  ];
}

function klendIx(name: "refreshReserve" | "refreshObligation", keys: ReturnType<typeof ro>[]) {
  const discriminators = {
    refreshReserve: [2, 218, 138, 235, 79, 201, 25, 102],
    refreshObligation: [33, 132, 147, 228, 151, 192, 72, 89],
  } as const;
  return {
    programId: KLEND_PROGRAM_ID,
    keys,
    data: Buffer.from(discriminators[name]),
  } as TransactionInstruction;
}

function refreshReserveIx(reserve: PublicKey, lendingMarket: PublicKey, feed: PublicKey) {
  return klendIx("refreshReserve", [
    rw(reserve),
    ro(lendingMarket),
    ro(feed),
    ro(KLEND_PROGRAM_ID),
    ro(KLEND_PROGRAM_ID),
    ro(KLEND_PROGRAM_ID),
  ]);
}

function executeActionIx(input: {
  guard: PublicKey;
  vault: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  debtReserve: PublicKey;
  vaultMint: PublicKey;
  reserveLiquiditySupply: PublicKey;
  deposits: PublicKey[];
  actionKind: number;
  amount: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(17);
  Buffer.from(EXECUTE_ACTION).copy(data, 0);
  data.writeUInt8(input.actionKind, 8);
  data.writeBigUInt64LE(input.amount, 9);

  return {
    programId: GUARD_PROGRAM_ID,
    keys: [
      rw(input.guard),
      rw(input.vault),
      { pubkey: agent.publicKey, isSigner: true, isWritable: false },
      rw(input.obligation),
      ro(input.lendingMarket),
      rw(input.debtReserve),
      ro(input.vaultMint),
      rw(input.reserveLiquiditySupply),
      ro(pda("lma", KLEND_PROGRAM_ID, input.lendingMarket)),
      ro(KLEND_PROGRAM_ID),
      ro(FARMS_PROGRAM_ID),
      ro(TOKEN_PROGRAM_ID),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      // Remaining accounts: the obligation's deposit reserves, in its own order.
      ...input.deposits.map(rw),
    ],
    data,
  } as TransactionInstruction;
}

/** Every guard this agent is named on. */
async function guardsForAgent(): Promise<{ address: PublicKey; data: Buffer }[]> {
  const accounts = await connection.getProgramAccounts(GUARD_PROGRAM_ID, {
    filters: [{ memcmp: { offset: G.agent, bytes: agent.publicKey.toBase58() } }],
  });
  return accounts.map(({ pubkey, account }) => ({ address: pubkey, data: account.data }));
}

async function tick(): Promise<void> {
  const guards = await guardsForAgent();
  if (guards.length === 0) {
    console.log(`${new Date().toISOString()}  no guards name this agent (${agent.publicKey.toBase58()})`);
    return;
  }

  for (const guard of guards) {
    const { data } = guard;
    const obligationKey = key(data, G.obligation);
    const paused = data[G_PAUSED] !== 0;
    const trigger = data.readUInt16LE(G_TRIGGER);
    const target = data.readUInt16LE(G_TARGET);
    const maxAction = data.readBigUInt64LE(G_MAX_ACTION);
    const expiresAt = data.readBigInt64LE(G_EXPIRES);
    const allowed = data[G_ALLOWED];

    const now = BigInt(Math.floor(Date.now() / 1000));
    const label = `${guard.address.toBase58().slice(0, 8)}…`;

    if (paused) {
      console.log(`${label} paused`);
      continue;
    }
    if (now >= expiresAt) {
      console.log(`${label} authorization expired`);
      continue;
    }
    if ((allowed & ACTION_REPAY) === 0) {
      console.log(`${label} repay is not permitted by the policy`);
      continue;
    }

    const obligationAccount = await connection.getAccountInfo(obligationKey);
    if (!obligationAccount) {
      console.log(`${label} obligation is gone`);
      continue;
    }

    const reserves = obligationReserves(obligationAccount.data);
    const deposits = reserves.filter((reserve) => !reserve.equals(key(data, G.debtReserve)));
    const lendingMarket = key(data, G.lendingMarket);
    const feeds = new Map([
      [market.collateral.reserve, market.collateral.pythFeed],
      [market.debt.reserve, market.debt.pythFeed],
    ]);

    // Refresh first, then read: the program refuses anything staler than two slots,
    // and the values on a stale account are whatever the last refresh left.
    const refresh = new Transaction();
    for (const reserve of reserves) {
      const feed = feeds.get(reserve.toBase58());
      if (feed) refresh.add(refreshReserveIx(reserve, lendingMarket, new PublicKey(feed)));
    }
    refresh.add(
      klendIx("refreshObligation", [ro(lendingMarket), rw(obligationKey), ...reserves.map(rw)]),
    );
    await sendAndConfirmTransaction(connection, refresh, [agent], { commitment: "confirmed" });

    const fresh = (await connection.getAccountInfo(obligationKey))!.data;
    const collateral = u128(fresh, O_COLLATERAL_VALUE);
    const debt = u128(fresh, O_DEBT_VALUE);
    const ltv = ltvBps(collateral, debt);

    const scheduleSeconds = data.readUInt32LE(G_SCHEDULE_SECONDS);
    const scheduleAmount = data.readBigUInt64LE(G_SCHEDULE_AMOUNT);
    const lastScheduledAt = data.readBigInt64LE(G_LAST_SCHEDULED);
    const scheduleDue =
      (allowed & ACTION_SCHEDULED_REPAY) !== 0 &&
      scheduleSeconds > 0 &&
      now - lastScheduledAt >= BigInt(scheduleSeconds);

    const vault = key(data, G.vault);
    const vaultBalance = BigInt((await connection.getTokenAccountBalance(vault)).value.amount);
    const ltvText = `${(ltv / 100).toFixed(2)}%`;

    let actionKind: number;
    let amount: bigint;

    if (ltv >= trigger) {
      // The emergency comes first when both apply. A scheduled payment that is due
      // stays due, and runs on the next tick; a position over its trigger does not
      // wait for anything.
      //
      // How much value has to go to reach the target, converted to an amount through
      // the vault's own balance. The program checks the same thing and reverts if
      // this overshoots, so being approximate here is safe rather than load bearing.
      const wanted = debt - (collateral * BigInt(target)) / 10_000n;
      const scale = 10n ** BigInt(market.debt.decimals);
      const wantedTokens = (wanted * scale) >> 60n;
      actionKind = ACTION_REPAY;
      amount = [wantedTokens, maxAction, vaultBalance].reduce((a, b) => (a < b ? a : b));
      console.log(
        `${label} LTV ${ltvText} >= ${(trigger / 100).toFixed(2)}%, repaying ${amount} ${market.debt.label}`,
      );
    } else if (scheduleDue) {
      // No target arithmetic here on purpose. A scheduled payment is a payment, not
      // a correction, so the amount is the one the owner set and the only thing that
      // can shrink it is an underfunded reserve.
      actionKind = ACTION_SCHEDULED_REPAY;
      amount = scheduleAmount < vaultBalance ? scheduleAmount : vaultBalance;
      console.log(
        `${label} scheduled payment due, repaying ${amount} ${market.debt.label} at LTV ${ltvText}`,
      );
    } else {
      const next = scheduleSeconds > 0 ? `, next payment in ${lastScheduledAt + BigInt(scheduleSeconds) - now}s` : "";
      console.log(`${label} LTV ${ltvText} is below the ${(trigger / 100).toFixed(2)}% trigger${next}`);
      continue;
    }

    if (amount === 0n) {
      console.log(`${label} there is something to do but the reserve is empty`);
      continue;
    }

    const action = new Transaction();
    for (const reserve of reserves) {
      const feed = feeds.get(reserve.toBase58());
      if (feed) action.add(refreshReserveIx(reserve, lendingMarket, new PublicKey(feed)));
    }
    action.add(
      klendIx("refreshObligation", [ro(lendingMarket), rw(obligationKey), ...reserves.map(rw)]),
      executeActionIx({
        guard: guard.address,
        vault,
        obligation: obligationKey,
        lendingMarket,
        debtReserve: key(data, G.debtReserve),
        vaultMint: key(data, G.vaultMint),
        reserveLiquiditySupply: pda("reserve_liq_supply", KLEND_PROGRAM_ID, key(data, G.debtReserve)),
        deposits,
        actionKind,
        amount,
      }),
    );

    try {
      const signature = await sendAndConfirmTransaction(connection, action, [agent], {
        commitment: "confirmed",
      });
      console.log(`  acted: ${signature}`);
    } catch (error) {
      // A revert is the program enforcing a limit this process cannot see the whole
      // of — a cooldown, a window, a target it would have overshot. It is expected
      // often enough that it is logged rather than thrown.
      console.log(`  refused: ${(error as Error).message.split("\n")[0]}`);
    }
  }
}

console.log(`agent   ${agent.publicKey.toBase58()}`);
console.log(`guard   ${GUARD_PROGRAM_ID.toBase58()}`);
console.log(`rpc     ${RPC}`);
console.log(ONCE ? "one pass\n" : `watching every ${INTERVAL_MS / 1000}s\n`);

await tick();
if (!ONCE) {
  setInterval(() => {
    tick().catch((error) => console.error(`tick failed: ${(error as Error).message}`));
  }, INTERVAL_MS);
}
