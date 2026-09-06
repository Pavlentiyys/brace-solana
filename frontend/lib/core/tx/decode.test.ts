import assert from "node:assert/strict";
import test from "node:test";

import { GUARD_ACCOUNT_DISCRIMINATOR } from "../program";
import { decodeBase58 } from "./base58";
import { decodeGuardConfig, GUARD_ACCOUNT_SIZE, looksLikeGuardAccount } from "./decode";

const KEYS = [
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr",
  "SysvarC1ock11111111111111111111111111111111",
  "SysvarRent111111111111111111111111111111111",
  "Sysvar1nstructions1111111111111111111111111",
];

/**
 * Builds the bytes the program would write, so the decoder is checked against a
 * layout spelled out here rather than against itself.
 */
function encodeAccount(): Uint8Array {
  const bytes = new Uint8Array(GUARD_ACCOUNT_SIZE);
  const view = new DataView(bytes.buffer);
  bytes.set(GUARD_ACCOUNT_DISCRIMINATOR, 0);

  let offset = 8;
  for (const key of KEYS) {
    bytes.set(decodeBase58(key), offset);
    offset += 32;
  }

  view.setUint16(offset, 7_000, true);
  offset += 2;
  view.setUint16(offset, 6_200, true);
  offset += 2;
  view.setBigUint64(offset, 900_000_000n, true);
  offset += 8;
  view.setUint8(offset, 3);
  offset += 1;
  view.setUint32(offset, 86_400, true);
  offset += 4;
  view.setUint32(offset, 300, true);
  offset += 4;
  view.setUint8(offset, 5);
  offset += 1;
  view.setUint32(offset, 604_800, true);
  offset += 4;
  view.setBigUint64(offset, 25_000_000n, true);
  offset += 8;
  view.setBigInt64(offset, 1_700_000_000n, true);
  offset += 8;
  view.setUint8(offset, 1);
  offset += 1;
  view.setBigInt64(offset, 1_699_999_000n, true);
  offset += 8;
  view.setBigInt64(offset, 1_699_990_000n, true);
  offset += 8;
  view.setUint8(offset, 2);
  offset += 1;
  view.setBigInt64(offset, 1_699_980_000n, true);
  offset += 8;
  view.setUint32(offset, 11, true);
  offset += 4;
  view.setBigUint64(offset, 4_321_000_000n, true);
  offset += 8;
  view.setUint8(offset, 254);
  offset += 1;
  view.setUint8(offset, 253);
  offset += 1;

  assert.equal(offset, GUARD_ACCOUNT_SIZE, "the layout in this test is the whole account");
  return bytes;
}

test("every field decodes at the offset the program wrote it to", () => {
  const guard = decodeGuardConfig("GuardPda", encodeAccount());

  assert.equal(guard.owner, KEYS[0]);
  assert.equal(guard.agent, KEYS[1]);
  assert.equal(guard.obligation, KEYS[2]);
  assert.equal(guard.lendingMarket, KEYS[3]);
  assert.equal(guard.debtReserve, KEYS[4]);
  assert.equal(guard.vault, KEYS[5]);
  assert.equal(guard.vaultMint, KEYS[6]);

  assert.deepEqual(guard.policy, {
    triggerLtvBps: 7_000,
    targetLtvBps: 6_200,
    maxActionAmount: 900_000_000n,
    maxActionsPerWindow: 3,
    windowSeconds: 86_400,
    cooldownSeconds: 300,
    allowedActions: 5,
    scheduleSeconds: 604_800,
    scheduleAmount: 25_000_000n,
    expiresAt: 1_700_000_000,
  });

  assert.equal(guard.paused, true);
  assert.equal(guard.lastActionAt, 1_699_999_000);
  assert.equal(guard.windowStartedAt, 1_699_990_000);
  assert.equal(guard.actionsInWindow, 2);
  assert.equal(guard.lastScheduledAt, 1_699_980_000);
  assert.equal(guard.totalActions, 11);
  assert.equal(guard.totalRepaid, 4_321_000_000n);
});

test("somebody else's account is refused rather than read as plausible numbers", () => {
  const bytes = encodeAccount();
  bytes[0] ^= 0xff;
  assert.equal(looksLikeGuardAccount(bytes), false);
  assert.throws(() => decodeGuardConfig("GuardPda", bytes), /not a GuardConfig account/);
});

test("a short buffer is refused, because a shorter account means a newer program", () => {
  assert.throws(
    () => decodeGuardConfig("GuardPda", encodeAccount().subarray(0, GUARD_ACCOUNT_SIZE - 1)),
    /should be 314 bytes/,
  );
});
