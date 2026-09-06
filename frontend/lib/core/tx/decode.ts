/**
 * Reading a `GuardConfig` account back off the chain.
 *
 * The counterpart to `instructions.ts`: that file writes the bytes the program
 * reads, this one reads the bytes the program wrote. Both belong in the shared
 * package because the bot displays the same account the panel does, and an account
 * layout understood two slightly different ways is a bug that only shows up on the
 * one field nobody looked at.
 *
 * Field order is the layout. `GuardConfig` in `state.rs` declares these in exactly
 * this sequence and Borsh writes them with no padding and no length prefixes, so a
 * reordering here silently shifts every field after it.
 */

import { GUARD_ACCOUNT_DISCRIMINATOR } from "@/lib/core/program";
import type { Guard } from "@/lib/core/guard";
import { encodeBase58 } from "@/lib/core/tx/base58";

/**
 * 8 discriminator + 7 keys + the scalars. Anchor sizes the account at this.
 *
 * Grew from 294 to 314 with the repayment schedule: `schedule_seconds` (4),
 * `schedule_amount` (8) and `last_scheduled_at` (8). An account written by the
 * previous program is shorter than this and is rejected rather than read with the
 * fields after `allowed_actions` shifted, which is what a length check is for.
 */
export const GUARD_ACCOUNT_SIZE = 314;

class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  skip(count: number): void {
    this.offset += count;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  /**
   * Unix timestamps come back as `number`, which is exact to 2^53 and so exact for
   * every second between now and the year 285000. Keeping them as `bigint` would
   * put a cast at every arithmetic site instead of one here.
   */
  timestamp(): number {
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return Number(value);
  }

  publicKey(): string {
    const value = encodeBase58(this.bytes.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return value;
  }
}

export function looksLikeGuardAccount(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return GUARD_ACCOUNT_DISCRIMINATOR.every((byte, index) => bytes[index] === byte);
}

/** The account size before the repayment schedule added its three fields. */
export const PREVIOUS_GUARD_ACCOUNT_SIZE = 294;

/**
 * A guard the deployed program wrote before the schedule, which cannot be read at
 * the current offsets and cannot be replaced either, because `init_guard` refuses an
 * occupied PDA.
 *
 * Worth naming rather than treating as a corrupt account. It is a live
 * authorization over somebody's position; it needs `migrate_guard` and then it works
 * again. Without this the interface would show "no authorization", offer to create
 * one, and fail inside the wallet with nothing on screen to explain it.
 */
export function needsMigration(bytes: Uint8Array): boolean {
  return looksLikeGuardAccount(bytes) && bytes.length === PREVIOUS_GUARD_ACCOUNT_SIZE;
}

/** Owner and obligation, which sit at fixed offsets in both layouts. */
export function guardIdentity(
  address: string,
  bytes: Uint8Array,
): { address: string; owner: string; obligation: string } {
  return {
    address,
    owner: encodeBase58(bytes.subarray(8, 40)),
    obligation: encodeBase58(bytes.subarray(72, 104)),
  };
}

/**
 * Decodes the account, or throws.
 *
 * Both checks are worth failing on rather than working around. A wrong
 * discriminator means this is somebody else's account and every field read out of
 * it would be a plausible looking number. A short buffer means the program was
 * upgraded and this reader was not.
 */
export function decodeGuardConfig(address: string, bytes: Uint8Array): Guard {
  if (!looksLikeGuardAccount(bytes)) {
    throw new Error(`${address} is not a GuardConfig account`);
  }
  if (bytes.length < GUARD_ACCOUNT_SIZE) {
    throw new Error(
      `GuardConfig should be ${GUARD_ACCOUNT_SIZE} bytes, ${address} is ${bytes.length}`,
    );
  }

  const reader = new Reader(bytes);
  reader.skip(8);

  const owner = reader.publicKey();
  const agent = reader.publicKey();
  const obligation = reader.publicKey();
  const lendingMarket = reader.publicKey();
  const debtReserve = reader.publicKey();
  const vault = reader.publicKey();
  const vaultMint = reader.publicKey();

  const triggerLtvBps = reader.u16();
  const targetLtvBps = reader.u16();
  const maxActionAmount = reader.u64();
  const maxActionsPerWindow = reader.u8();
  const windowSeconds = reader.u32();
  const cooldownSeconds = reader.u32();
  const allowedActions = reader.u8();
  const scheduleSeconds = reader.u32();
  const scheduleAmount = reader.u64();
  const expiresAt = reader.timestamp();
  const paused = reader.bool();

  return {
    address,
    owner,
    agent,
    obligation,
    lendingMarket,
    debtReserve,
    vault,
    vaultMint,
    policy: {
      triggerLtvBps,
      targetLtvBps,
      maxActionAmount,
      maxActionsPerWindow,
      windowSeconds,
      cooldownSeconds,
      allowedActions,
      scheduleSeconds,
      scheduleAmount,
      expiresAt,
    },
    paused,
    lastActionAt: reader.timestamp(),
    windowStartedAt: reader.timestamp(),
    actionsInWindow: reader.u8(),
    lastScheduledAt: reader.timestamp(),
    totalActions: reader.u32(),
    totalRepaid: reader.u64(),
  };
}
