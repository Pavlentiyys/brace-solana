import assert from "node:assert/strict";
import test from "node:test";

import {
  FAUCET_LAMPORTS,
  FaucetError,
  requestDevnetAirdrop,
  waitForAirdropConfirmation,
} from "./faucet";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SIGNATURE =
  "4cdd1oX7cfVALfr26tP52BZ6cSzrgnNGtYD7BFhm6FFeZV5sPTnRvg6NRn8yC6DbEikXcrNChBM5vVJnTgKhGhVu";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("requests exactly one SOL from the devnet faucet", async () => {
  let request: RequestInit | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    request = init;
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: SIGNATURE });
  };

  const signature = await requestDevnetAirdrop({
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    address: ADDRESS,
    fetcher,
  });

  assert.equal(signature, SIGNATURE);
  assert.deepEqual(JSON.parse(String(request?.body)), {
    jsonrpc: "2.0",
    id: 1,
    method: "requestAirdrop",
    params: [ADDRESS, FAUCET_LAMPORTS, { commitment: "confirmed" }],
  });
});

test("refuses non-devnet clusters before making a request", async () => {
  let called = false;
  await assert.rejects(
    () =>
      requestDevnetAirdrop({
        cluster: "mainnet-beta",
        rpcUrl: "https://api.mainnet-beta.solana.com",
        address: ADDRESS,
        fetcher: async () => {
          called = true;
          return jsonResponse({});
        },
      }),
    (error: unknown) => error instanceof FaucetError && error.code === "unsupported_cluster",
  );
  assert.equal(called, false);
});

test("refuses an invalid destination before making a request", async () => {
  let called = false;
  await assert.rejects(
    () =>
      requestDevnetAirdrop({
        cluster: "devnet",
        rpcUrl: "https://api.devnet.solana.com",
        address: "not-a-public-key",
        fetcher: async () => {
          called = true;
          return jsonResponse({});
        },
      }),
    (error: unknown) => error instanceof FaucetError && error.code === "invalid_address",
  );
  assert.equal(called, false);
});

test("turns HTTP 429 into a rate-limit error", async () => {
  await assert.rejects(
    () =>
      requestDevnetAirdrop({
        cluster: "devnet",
        rpcUrl: "https://api.devnet.solana.com",
        address: ADDRESS,
        fetcher: async () => jsonResponse({}, 429),
      }),
    (error: unknown) => error instanceof FaucetError && error.code === "rate_limited",
  );
});

test("waits through a processed status and accepts confirmed", async () => {
  const responses = [
    { result: { value: [{ err: null, confirmationStatus: "processed" }] } },
    { result: { value: [{ err: null, confirmationStatus: "confirmed" }] } },
  ];
  const requests: unknown[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return jsonResponse({ jsonrpc: "2.0", id: 1, ...responses.shift() });
  };

  await waitForAirdropConfirmation({
    rpcUrl: "https://api.devnet.solana.com",
    signature: SIGNATURE,
    fetcher,
    pollIntervalMs: 0,
    maxAttempts: 2,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    jsonrpc: "2.0",
    id: 1,
    method: "getSignatureStatuses",
    params: [[SIGNATURE], { searchTransactionHistory: true }],
  });
});

test("surfaces a failed airdrop transaction", async () => {
  await assert.rejects(
    () =>
      waitForAirdropConfirmation({
        rpcUrl: "https://api.devnet.solana.com",
        signature: SIGNATURE,
        fetcher: async () =>
          jsonResponse({
            jsonrpc: "2.0",
            id: 1,
            result: { value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] },
          }),
        maxAttempts: 1,
      }),
    (error: unknown) => error instanceof FaucetError && error.code === "transaction_failed",
  );
});
