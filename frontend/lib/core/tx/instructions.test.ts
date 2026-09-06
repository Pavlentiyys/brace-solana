import assert from "node:assert/strict";
import test from "node:test";

import { defaultPolicy } from "../policy";
import { ALLOWED_ACTIONS_SCHEDULED, DISCRIMINATORS } from "../program";
import { decodeBase58, decodePublicKey, encodeBase58, isValidPublicKey, shortenAddress } from "./base58";
import {
  depositReserveData,
  initGuardData,
  revokeData,
  updatePolicyData,
  withdrawReserveData,
  WITHDRAW_ALL,
} from "./instructions";

const NOW = 1_700_000_000;
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

test("the all-zero key is thirty two zero bytes and round trips", () => {
  const bytes = decodePublicKey(SYSTEM_PROGRAM);
  assert.equal(bytes.length, 32);
  assert.ok(bytes.every((byte) => byte === 0));
  assert.equal(encodeBase58(bytes), SYSTEM_PROGRAM);
});

test("a real address round trips byte for byte", () => {
  assert.equal(encodeBase58(decodeBase58(TOKEN_PROGRAM)), TOKEN_PROGRAM);
  assert.equal(decodePublicKey(TOKEN_PROGRAM).length, 32);
});

test("a key of the wrong length is rejected rather than padded", () => {
  assert.equal(isValidPublicKey("abc"), false);
  assert.equal(isValidPublicKey(`${TOKEN_PROGRAM}x`), false);
  assert.equal(isValidPublicKey(TOKEN_PROGRAM), true);
  // 0 is not in the alphabet precisely so that it cannot be confused with O.
  assert.equal(isValidPublicKey("0000000000000000000000000000000000000000000"), false);
});

test("shortening keeps both ends, because that is what people compare", () => {
  assert.equal(shortenAddress(TOKEN_PROGRAM), "Toke…Q5DA");
});

test("every instruction starts with its discriminator", () => {
  const cases: [Uint8Array, readonly number[]][] = [
    [initGuardData(TOKEN_PROGRAM, defaultPolicy(NOW)), DISCRIMINATORS.init_guard],
    [depositReserveData(1n), DISCRIMINATORS.deposit_reserve],
    [withdrawReserveData(1n), DISCRIMINATORS.withdraw_reserve],
    [updatePolicyData(TOKEN_PROGRAM, defaultPolicy(NOW), false), DISCRIMINATORS.update_policy],
    [revokeData(), DISCRIMINATORS.revoke],
  ];

  for (const [data, discriminator] of cases) {
    assert.deepEqual([...data.slice(0, 8)], [...discriminator]);
  }
});

test("revoke carries no arguments, which is what makes it one click", () => {
  assert.equal(revokeData().length, 8);
});

test("u64 amounts are little endian", () => {
  const data = depositReserveData(1n);
  assert.equal(data.length, 8 + 8);
  assert.deepEqual([...data.slice(8)], [1, 0, 0, 0, 0, 0, 0, 0]);
});

test("the withdraw-everything sentinel is u64::MAX", () => {
  const data = withdrawReserveData(WITHDRAW_ALL);
  assert.deepEqual([...data.slice(8)], [255, 255, 255, 255, 255, 255, 255, 255]);
});

test("InitGuardArgs is a pubkey followed by the policy struct", () => {
  // 8 discriminator + 32 agent + PolicyParams
  // (2 + 2 + 8 + 1 + 4 + 4 + 1 + 4 + 8 + 8), the last two being the schedule.
  const data = initGuardData(TOKEN_PROGRAM, defaultPolicy(NOW));
  assert.equal(data.length, 8 + 32 + 42);
  assert.deepEqual([...data.slice(8, 40)], [...decodePublicKey(TOKEN_PROGRAM)]);
});

test("policy fields are written in the order the struct declares them", () => {
  const policy = {
    ...defaultPolicy(NOW),
    triggerLtvBps: 0x1234,
    targetLtvBps: 0x5678,
    maxActionAmount: 0xffn,
    maxActionsPerWindow: 3,
    windowSeconds: 0x0102_0304,
    cooldownSeconds: 60,
    allowedActions: ALLOWED_ACTIONS_SCHEDULED,
    scheduleSeconds: 0x0a0b_0c0d,
    scheduleAmount: 0xeen,
    expiresAt: 1,
  };
  const body = initGuardData(TOKEN_PROGRAM, policy).slice(40);

  assert.deepEqual([...body.slice(0, 2)], [0x34, 0x12]);
  assert.deepEqual([...body.slice(2, 4)], [0x78, 0x56]);
  assert.deepEqual([...body.slice(4, 12)], [0xff, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(body[12], 3);
  assert.deepEqual([...body.slice(13, 17)], [0x04, 0x03, 0x02, 0x01]);
  assert.deepEqual([...body.slice(17, 21)], [60, 0, 0, 0]);
  assert.equal(body[21], policy.allowedActions);
  assert.deepEqual([...body.slice(22, 26)], [0x0d, 0x0c, 0x0b, 0x0a]);
  assert.deepEqual([...body.slice(26, 34)], [0xee, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...body.slice(34, 42)], [1, 0, 0, 0, 0, 0, 0, 0]);
});

test("update_policy appends the paused flag after the policy", () => {
  const policy = defaultPolicy(NOW);
  const paused = updatePolicyData(TOKEN_PROGRAM, policy, true);
  const running = updatePolicyData(TOKEN_PROGRAM, policy, false);

  assert.equal(paused.length, 8 + 32 + 42 + 1);
  assert.equal(paused.at(-1), 1);
  assert.equal(running.at(-1), 0);
});

test("a negative expiry serialises as two's complement rather than throwing", () => {
  // Not a policy the program accepts, but i64 is signed and the encoder has to be
  // honest about that instead of producing a shorter buffer.
  const data = initGuardData(TOKEN_PROGRAM, { ...defaultPolicy(NOW), expiresAt: -1 });
  assert.deepEqual([...data.slice(-8)], [255, 255, 255, 255, 255, 255, 255, 255]);
});
