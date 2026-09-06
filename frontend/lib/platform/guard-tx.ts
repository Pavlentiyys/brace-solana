/**
 * The guard's own instructions, assembled for signing.
 *
 * The bytes were already written: `lib/core/tx/instructions.ts` encodes every
 * argument and pins the layout against the Rust source. This module only resolves
 * the accounts and wraps the result in something a wallet will sign, which is why it
 * is the half that imports `@solana/web3.js` and `lib/core` stays framework free.
 *
 * Signer and writability flags come from `program/idl/guard.json`. They are not
 * decoration: a missing `mut` fails on chain after the user has already approved the
 * transaction, and a stray signer asks somebody to sign for an account they do not
 * own.
 */

import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";

import { PROGRAM_ID, SEED_GUARD, SEED_VAULT } from "@/lib/core/program";
import {
  depositReserveData,
  initGuardData,
  migrateGuardData,
  ownerRepayData,
  revokeData,
  updatePolicyData,
  withdrawReserveData,
} from "@/lib/core/tx/instructions";
import type { Policy } from "@/lib/core/policy";
import {
  associatedTokenAddress,
  KLEND_PROGRAM_ID,
  marketAuthority,
  reserveAccounts,
  TOKEN_PROGRAM_ID,
} from "@/lib/platform/klend-tx";

/** Required by KLend v2 in the repay account list even when no farm is attached. */
const FARMS_PROGRAM_ID = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");

export const GUARD_PROGRAM_ID = new PublicKey(PROGRAM_ID);

const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const sig = (pubkey: PublicKey, isWritable = true) => ({ pubkey, isSigner: true, isWritable });

function seed(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function guardAddress(owner: PublicKey, obligation: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEED_GUARD), owner.toBuffer(), obligation.toBuffer()],
    GUARD_PROGRAM_ID,
  )[0];
}

export function vaultAddress(guard: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEED_VAULT), guard.toBuffer()],
    GUARD_PROGRAM_ID,
  )[0];
}

function instruction(data: Uint8Array, keys: ReturnType<typeof ro>[]): TransactionInstruction {
  return new TransactionInstruction({
    programId: GUARD_PROGRAM_ID,
    keys,
    // `Buffer.from` only, never a Node-only Buffer method: the browser polyfill has
    // neither `writeBigUInt64LE` nor its siblings.
    data: Buffer.from(data),
  });
}

export interface GuardAccounts {
  owner: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  debtReserve: PublicKey;
  /** The reserve mint the vault is funded in. `init_guard` requires they match. */
  vaultMint: PublicKey;
}

/**
 * `init_guard`. Creates the guard and its vault, and records the policy.
 *
 * The vault is its own token authority, so the guard can move funds out of it
 * without any further signature from the owner — and cannot move them anywhere the
 * program does not name.
 */
export function initGuardIx(
  accounts: GuardAccounts,
  agent: PublicKey,
  policy: Policy,
): TransactionInstruction {
  const guard = guardAddress(accounts.owner, accounts.obligation);

  return instruction(initGuardData(agent.toBase58(), policy), [
    sig(accounts.owner),
    ro(agent),
    ro(accounts.obligation),
    ro(accounts.lendingMarket),
    ro(accounts.debtReserve),
    ro(accounts.vaultMint),
    rw(guard),
    rw(vaultAddress(guard)),
    ro(TOKEN_PROGRAM_ID),
    ro(SystemProgram.programId),
  ]);
}

export function depositReserveIx(
  accounts: GuardAccounts,
  amount: bigint,
): TransactionInstruction {
  const guard = guardAddress(accounts.owner, accounts.obligation);

  return instruction(depositReserveData(amount), [
    ro(guard),
    sig(accounts.owner),
    rw(vaultAddress(guard)),
    rw(associatedTokenAddress(accounts.vaultMint, accounts.owner)),
    ro(accounts.vaultMint),
    ro(TOKEN_PROGRAM_ID),
  ]);
}

export function withdrawReserveIx(
  accounts: GuardAccounts,
  amount: bigint,
): TransactionInstruction {
  const guard = guardAddress(accounts.owner, accounts.obligation);

  return instruction(withdrawReserveData(amount), [
    ro(guard),
    sig(accounts.owner),
    rw(vaultAddress(guard)),
    rw(associatedTokenAddress(accounts.vaultMint, accounts.owner)),
    ro(accounts.vaultMint),
    ro(TOKEN_PROGRAM_ID),
  ]);
}

/** `update_policy`, which is also how pausing and resuming are expressed. */
export function updatePolicyIx(
  accounts: GuardAccounts,
  agent: PublicKey,
  policy: Policy,
  paused: boolean,
): TransactionInstruction {
  const guard = guardAddress(accounts.owner, accounts.obligation);

  return instruction(updatePolicyData(agent.toBase58(), policy, paused), [
    rw(guard),
    sig(accounts.owner, false),
    ro(accounts.obligation),
  ]);
}

/**
 * `migrate_guard`. Grows an authorization written by a previous program.
 *
 * The owner signs and pays the rent on the bytes the account gains. Nothing about
 * the authorization changes; it becomes readable again, with the schedule off.
 */
export function migrateGuardIx(accounts: GuardAccounts): TransactionInstruction {
  return instruction(migrateGuardData(), [
    rw(guardAddress(accounts.owner, accounts.obligation)),
    sig(accounts.owner),
    ro(SystemProgram.programId),
  ]);
}

/**
 * `owner_repay`. Sends the reserve at the debt on the owner's own signature.
 *
 * The account list is `execute_action`'s with the owner in the signer slot, and the
 * obligation's deposit reserves trailing as remaining accounts in the order the
 * obligation itself lists them. The program walks that order and refuses a list that
 * has been reordered or padded, so it cannot be assembled from a set.
 *
 * This instruction must be preceded in the same transaction by a refresh of every
 * reserve and of the obligation. The program rejects anything staler than two slots,
 * which is deliberate and is why `planRepayNow` builds the whole transaction rather
 * than handing back one instruction.
 */
export function ownerRepayIx(
  accounts: GuardAccounts,
  amount: bigint,
  depositReserves: PublicKey[],
): TransactionInstruction {
  const guard = guardAddress(accounts.owner, accounts.obligation);

  return instruction(ownerRepayData(amount), [
    rw(guard),
    rw(vaultAddress(guard)),
    sig(accounts.owner, false),
    rw(accounts.obligation),
    ro(accounts.lendingMarket),
    rw(accounts.debtReserve),
    ro(accounts.vaultMint),
    rw(reserveAccounts(accounts.debtReserve).liquiditySupply),
    ro(marketAuthority(accounts.lendingMarket)),
    ro(KLEND_PROGRAM_ID),
    ro(FARMS_PROGRAM_ID),
    ro(TOKEN_PROGRAM_ID),
    ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ...depositReserves.map(rw),
  ]);
}

/**
 * `revoke`. Pauses, expires and clears the allowed actions in one instruction.
 *
 * It does not touch the vault. Withdrawing keeps working afterwards, which is the
 * guarantee three tests in the program exist to prove.
 */
export function revokeIx(accounts: GuardAccounts): TransactionInstruction {
  return instruction(revokeData(), [
    rw(guardAddress(accounts.owner, accounts.obligation)),
    sig(accounts.owner, false),
  ]);
}
