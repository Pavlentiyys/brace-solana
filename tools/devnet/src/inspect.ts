/**
 * Verifies the PDA seeds against a reserve that already exists on devnet.
 *
 * Run this before creating anything. If the derivation here disagrees with what
 * Kamino actually stored, `initReserve` would fail on chain with an account
 * mismatch and no explanation, and the seeds are the one part of this package that
 * cannot be read out of the IDL.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { KLEND_PROGRAM_ID, RESERVE_SIZE, marketAuthority, reserveAccounts } from "./klend.js";

const RPC = process.env.BRACE_RPC_URL ?? "https://api.devnet.solana.com";

/** Offsets from `program/programs/guard/src/adapter/kamino.rs`. */
const R_LENDING_MARKET = 32;
const R_LIQUIDITY = 128;
const R_LIQUIDITY_MINT = R_LIQUIDITY;
const R_LIQUIDITY_SUPPLY = R_LIQUIDITY + 32;
const R_FEE_VAULT = R_LIQUIDITY + 64;
// ReserveCollateral sits after `liquidity` (128..1360, so 1232 bytes) and its
// 1200-byte padding. An earlier guess of 2552 was eight bytes short and produced
// four confident, wrong addresses.
const R_COLLATERAL = 2_560;
const R_COLLATERAL_MINT = R_COLLATERAL;
const R_COLLATERAL_SUPPLY = R_COLLATERAL + 40;
const R_TOKEN_NAME = 5_032;

function key(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function name(data: Buffer): string {
  const slice = data.subarray(R_TOKEN_NAME, R_TOKEN_NAME + 32);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? undefined : end).toString("utf8").trim();
}

const connection = new Connection(RPC, "confirmed");

const accounts = await connection.getProgramAccounts(KLEND_PROGRAM_ID, {
  filters: [{ dataSize: RESERVE_SIZE }],
  dataSlice: undefined,
});

console.log(`${accounts.length} reserves on ${RPC}\n`);

let checked = 0;
let mismatched = 0;

for (const { pubkey, account } of accounts.slice(0, 12)) {
  const data = account.data;
  const derived = reserveAccounts(pubkey);

  const rows: [string, PublicKey, PublicKey][] = [
    ["liquiditySupply", derived.liquiditySupply, key(data, R_LIQUIDITY_SUPPLY)],
    ["feeReceiver", derived.feeReceiver, key(data, R_FEE_VAULT)],
    ["collateralMint", derived.collateralMint, key(data, R_COLLATERAL_MINT)],
    ["collateralSupply", derived.collateralSupply, key(data, R_COLLATERAL_SUPPLY)],
  ];

  const bad = rows.filter(([, want, got]) => !want.equals(got));
  checked += 1;
  if (bad.length > 0) {
    mismatched += 1;
    console.log(`✗ ${name(data) || pubkey.toBase58().slice(0, 8)} (${pubkey.toBase58()})`);
    for (const [label, want, got] of bad) {
      console.log(`    ${label}: derived ${want.toBase58()} but chain has ${got.toBase58()}`);
    }
  } else {
    console.log(`✓ ${(name(data) || pubkey.toBase58().slice(0, 8)).padEnd(12)} all four PDAs match`);
  }
}

const sample = accounts[0];
if (sample) {
  const market = key(sample.account.data, R_LENDING_MARKET);
  console.log(`\nmarket authority for ${market.toBase58()}`);
  console.log(`  ${marketAuthority(market).toBase58()}`);
}

console.log(`\n${checked - mismatched}/${checked} reserves matched.`);
if (mismatched > 0) process.exit(1);
