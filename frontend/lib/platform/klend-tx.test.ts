import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  DISCRIMINATORS,
  KLEND_PROGRAM_ID,
  associatedTokenAddress,
  borrowIx,
  depositIx,
  initObligationIx,
  marketAuthority,
  obligationAddress,
  refreshObligationIx,
  refreshReserveIx,
  reserveAccounts,
} from "./klend-tx";
import { DEVNET_MARKET } from "./devnet-market";

/**
 * The write path, which cannot be checked by clicking.
 *
 * A wrong discriminator or a misplaced account produces a transaction that fails on
 * chain with a code and no explanation, after the user has already approved it in
 * their wallet. Everything here is derivable, so everything here is derived twice and
 * compared.
 */

const OWNER = new PublicKey("4JgfqG3GhbXSm5j3pDCa8d8FiQTLT6nmEohtawD77zq9");
const MARKET = new PublicKey(DEVNET_MARKET.lendingMarket);

test("every discriminator is the anchor hash of its instruction name", () => {
  const names: Record<keyof typeof DISCRIMINATORS, string> = {
    initUserMetadata: "init_user_metadata",
    initObligation: "init_obligation",
    refreshReserve: "refresh_reserve",
    refreshObligation: "refresh_obligation",
    depositReserveLiquidityAndObligationCollateral:
      "deposit_reserve_liquidity_and_obligation_collateral",
    borrowObligationLiquidity: "borrow_obligation_liquidity",
  };

  for (const [key, snakeCase] of Object.entries(names)) {
    const expected = [
      ...createHash("sha256").update(`global:${snakeCase}`).digest().subarray(0, 8),
    ];
    assert.deepEqual(
      [...DISCRIMINATORS[key as keyof typeof DISCRIMINATORS]],
      expected,
      `${snakeCase} discriminator`,
    );
  }
});

test("reserve accounts are seeded by the reserve alone", () => {
  // Seeding by [market, mint] is the obvious guess and produces four confident,
  // wrong addresses. `tools/devnet` checks this against live reserves; here it is
  // pinned so a refactor cannot quietly change it.
  const reserve = new PublicKey(DEVNET_MARKET.collateral.reserve);
  const derived = reserveAccounts(reserve);

  for (const [seed, address] of [
    ["reserve_liq_supply", derived.liquiditySupply],
    ["fee_receiver", derived.feeReceiver],
    ["reserve_coll_mint", derived.collateralMint],
    ["reserve_coll_supply", derived.collateralSupply],
  ] as const) {
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from(seed), reserve.toBuffer()],
      KLEND_PROGRAM_ID,
    );
    assert.ok(expected.equals(address), seed);
  }
});

test("the obligation address is the vanilla tag-0 id-0 derivation", () => {
  const [expected] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]),
      Buffer.from([0]),
      OWNER.toBuffer(),
      MARKET.toBuffer(),
      PublicKey.default.toBuffer(),
      PublicKey.default.toBuffer(),
    ],
    KLEND_PROGRAM_ID,
  );
  assert.ok(expected.equals(obligationAddress(OWNER, MARKET)));
});

test("the market authority uses the lma seed", () => {
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), MARKET.toBuffer()],
    KLEND_PROGRAM_ID,
  );
  assert.ok(expected.equals(marketAuthority(MARKET)));
});

test("amounts are encoded as little endian u64 after the discriminator", () => {
  const amount = 123_456_789n;
  const instruction = depositIx({
    owner: OWNER,
    market: MARKET,
    reserve: new PublicKey(DEVNET_MARKET.collateral.reserve),
    liquidityMint: new PublicKey(DEVNET_MARKET.collateral.mint),
    amount,
  });

  assert.equal(instruction.data.length, 16);
  assert.deepEqual(
    [...instruction.data.subarray(0, 8)],
    [...DISCRIMINATORS.depositReserveLiquidityAndObligationCollateral],
  );

  // Read back through DataView rather than `readBigUInt64LE`, because that method is
  // Node's and the browser polyfill does not have it — asserting with it would pass
  // here while the real thing threw in the wallet.
  const bytes = Uint8Array.from(instruction.data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getBigUint64(8, true), amount);
});

test("instruction data is built without Node-only Buffer methods", () => {
  // The regression: `Buffer.alloc(8).writeBigUInt64LE(...)` works in Node, passes
  // every test, and throws "writeBigUInt64LE is not a function" the moment a real
  // wallet is asked to sign. This runs the same builders against a Buffer stripped
  // of everything the browser polyfill lacks.
  const NODE_ONLY = [
    "writeBigUInt64LE",
    "writeBigUInt64BE",
    "readBigUInt64LE",
    "readBigUInt64BE",
    "writeBigInt64LE",
    "readBigInt64LE",
  ] as const;

  const original = new Map<string, unknown>();
  for (const method of NODE_ONLY) {
    original.set(method, (Buffer.prototype as unknown as Record<string, unknown>)[method]);
    delete (Buffer.prototype as unknown as Record<string, unknown>)[method];
  }

  try {
    const shared = {
      owner: OWNER,
      market: MARKET,
      reserve: new PublicKey(DEVNET_MARKET.debt.reserve),
      liquidityMint: new PublicKey(DEVNET_MARKET.debt.mint),
      amount: 987_654_321n,
    };

    assert.doesNotThrow(() => depositIx(shared));
    assert.doesNotThrow(() => borrowIx(shared));
    assert.doesNotThrow(() => initObligationIx(OWNER, MARKET));
    assert.doesNotThrow(() =>
      refreshReserveIx(shared.reserve, MARKET, new PublicKey(DEVNET_MARKET.debt.pythFeed)),
    );

    const bytes = Uint8Array.from(borrowIx(shared).data);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getBigUint64(8, true), shared.amount);
  } finally {
    for (const [method, implementation] of original) {
      (Buffer.prototype as unknown as Record<string, unknown>)[method] = implementation;
    }
  }
});

test("the owner is the only signer on deposit and borrow", () => {
  const shared = {
    owner: OWNER,
    market: MARKET,
    reserve: new PublicKey(DEVNET_MARKET.debt.reserve),
    liquidityMint: new PublicKey(DEVNET_MARKET.debt.mint),
    amount: 1n,
  };

  for (const instruction of [depositIx(shared), borrowIx(shared)]) {
    const signers = instruction.keys.filter((key) => key.isSigner).map((key) => key.pubkey);
    assert.equal(signers.length, 1);
    assert.ok(signers[0].equals(OWNER));
    assert.ok(instruction.programId.equals(KLEND_PROGRAM_ID));
  }
});

test("the borrow sends the tokens to the owner's own associated account", () => {
  const mint = new PublicKey(DEVNET_MARKET.debt.mint);
  const instruction = borrowIx({
    owner: OWNER,
    market: MARKET,
    reserve: new PublicKey(DEVNET_MARKET.debt.reserve),
    liquidityMint: mint,
    amount: 1n,
  });

  // Index 8 is `userDestinationLiquidity`. Anything else there sends somebody's
  // borrow to somebody else.
  assert.ok(instruction.keys[8].pubkey.equals(associatedTokenAddress(mint, OWNER)));
  assert.ok(instruction.keys[8].isWritable);
});

test("an absent optional account is written as the program id", () => {
  // Anchor's convention. A zero pubkey there is a different account entirely and
  // KLend would reject it.
  const instruction = borrowIx({
    owner: OWNER,
    market: MARKET,
    reserve: new PublicKey(DEVNET_MARKET.debt.reserve),
    liquidityMint: new PublicKey(DEVNET_MARKET.debt.mint),
    amount: 1n,
  });
  assert.ok(instruction.keys[9].pubkey.equals(KLEND_PROGRAM_ID), "referrerTokenState");
});

test("refresh_obligation lists the reserves in the order it is given", () => {
  const a = new PublicKey(DEVNET_MARKET.collateral.reserve);
  const b = new PublicKey(DEVNET_MARKET.debt.reserve);
  const instruction = refreshObligationIx(obligationAddress(OWNER, MARKET), MARKET, [a, b]);

  // market, obligation, then the reserves. KLend rejects any other set or order.
  assert.equal(instruction.keys.length, 4);
  assert.ok(instruction.keys[2].pubkey.equals(a));
  assert.ok(instruction.keys[3].pubkey.equals(b));
  assert.ok(instruction.keys.slice(2).every((key) => key.isWritable));
});

test("refresh_reserve carries the pyth feed and three absent oracles", () => {
  const feed = new PublicKey(DEVNET_MARKET.collateral.pythFeed);
  const instruction = refreshReserveIx(
    new PublicKey(DEVNET_MARKET.collateral.reserve),
    MARKET,
    feed,
  );

  assert.ok(instruction.keys[2].pubkey.equals(feed));
  for (const index of [3, 4, 5]) {
    assert.ok(instruction.keys[index].pubkey.equals(KLEND_PROGRAM_ID), `oracle slot ${index}`);
  }
});

test("init_obligation encodes tag 0 and id 0", () => {
  const instruction = initObligationIx(OWNER, MARKET);
  assert.deepEqual([...instruction.data.subarray(8)], [0, 0]);
});

test("the market config points at devnet and two distinct reserves", () => {
  assert.equal(DEVNET_MARKET.cluster, "devnet");
  assert.notEqual(DEVNET_MARKET.collateral.reserve, DEVNET_MARKET.debt.reserve);
  assert.notEqual(DEVNET_MARKET.collateral.mint, DEVNET_MARKET.debt.mint);
  assert.equal(DEVNET_MARKET.collateral.decimals, 9);
  assert.equal(DEVNET_MARKET.debt.decimals, 6);
});
