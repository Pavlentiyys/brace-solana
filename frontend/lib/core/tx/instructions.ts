/**
 * Instruction data for the guard program.
 *
 * This is the half of "transactions are not assembled by hand" (PLATFORM.md 5) that
 * genuinely has to be shared between the web and the bot: the byte layout of the
 * arguments. Two implementations of a Borsh struct is two chances to serialise a
 * `u16` where the program reads a `u64`, and the failure shows up as an
 * `InvalidPolicy` from the chain with nothing on screen to explain it.
 *
 * What this file deliberately does NOT do is derive addresses or assemble the
 * transaction. A program derived address needs an ed25519 curve check, which needs
 * a real crypto library, and a signed transaction needs a wallet. Those belong in
 * the adapter next to the wallet, which is the only place they can be exercised.
 * The account ORDER is here, because it is part of the same contract as the bytes
 * and it is pinned against the IDL by the test beside this file.
 */

import { DISCRIMINATORS, type InstructionName } from "@/lib/core/program";
import type { Policy } from "@/lib/core/policy";
import { decodePublicKey } from "@/lib/core/tx/base58";

/** Account order per instruction, exactly as `program/idl/guard.json` declares it. */
export const ACCOUNT_ORDER = {
  init_guard: [
    "owner",
    "agent",
    "obligation",
    "lending_market",
    "debt_reserve",
    "vault_mint",
    "guard",
    "vault",
    "token_program",
    "system_program",
  ],
  deposit_reserve: ["guard", "owner", "vault", "owner_source", "vault_mint", "token_program"],
  withdraw_reserve: ["guard", "owner", "vault", "owner_destination", "vault_mint", "token_program"],
  update_policy: ["guard", "owner", "obligation"],
  revoke: ["guard", "owner"],
  execute_action: [
    "guard",
    "vault",
    "agent",
    "obligation",
    "lending_market",
    "debt_reserve",
    "vault_mint",
    "reserve_liquidity_supply",
    "lending_market_authority",
    "lending_program",
    "farms_program",
    "token_program",
    "instruction_sysvar",
  ],
} as const satisfies Record<InstructionName, readonly string[]>;

/** Little endian, which is what Borsh uses for every integer. */
class Writer {
  private readonly bytes: number[] = [];

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  u16(value: number): this {
    return this.u8(value).u8(value >>> 8);
  }

  u32(value: number): this {
    return this.u16(value).u16(value >>> 16);
  }

  /** Also serves `i64`: two's complement is the same eight bytes. */
  u64(value: bigint): this {
    let remaining = BigInt.asUintN(64, value);
    for (let i = 0; i < 8; i++) {
      this.u8(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
    return this;
  }

  i64(value: bigint): this {
    return this.u64(value);
  }

  raw(values: Iterable<number>): this {
    for (const value of values) this.u8(value);
    return this;
  }

  publicKey(address: string): this {
    return this.raw(decodePublicKey(address));
  }

  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

function writer(instruction: InstructionName): Writer {
  return new Writer().raw(DISCRIMINATORS[instruction]);
}

/**
 * `PolicyParams`, in declaration order. The order is the layout: Borsh writes
 * fields in the order the struct declares them and reads them back the same way,
 * so reordering these lines silently corrupts every field after the first change.
 */
function writePolicy(target: Writer, policy: Policy): Writer {
  return target
    .u16(policy.triggerLtvBps)
    .u16(policy.targetLtvBps)
    .u64(policy.maxActionAmount)
    .u8(policy.maxActionsPerWindow)
    .u32(policy.windowSeconds)
    .u32(policy.cooldownSeconds)
    .u8(policy.allowedActions)
    .i64(BigInt(policy.expiresAt));
}

/** `init_guard(InitGuardArgs { agent, policy })`. */
export function initGuardData(agent: string, policy: Policy): Uint8Array {
  return writePolicy(writer("init_guard").publicKey(agent), policy).finish();
}

/** `update_policy(UpdatePolicyArgs { agent, policy, paused })`. */
export function updatePolicyData(agent: string, policy: Policy, paused: boolean): Uint8Array {
  return writePolicy(writer("update_policy").publicKey(agent), policy).bool(paused).finish();
}

export function depositReserveData(amount: bigint): Uint8Array {
  return writer("deposit_reserve").u64(amount).finish();
}

/**
 * `u64::MAX` is the program's "everything in the vault" sentinel, and it is the
 * amount the panel's withdraw-all button sends. Reading the balance and passing it
 * back would race an action landing in between and fail on the difference.
 */
export const WITHDRAW_ALL = 0xffff_ffff_ffff_ffffn;

export function withdrawReserveData(amount: bigint): Uint8Array {
  return writer("withdraw_reserve").u64(amount).finish();
}

export function revokeData(): Uint8Array {
  return writer("revoke").finish();
}

export function executeActionData(actionKind: number, amount: bigint): Uint8Array {
  return writer("execute_action").u8(actionKind).u64(amount).finish();
}
