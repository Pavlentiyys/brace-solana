import { decodeBase58, isValidPublicKey } from "@/lib/core/tx/base58";
import type { Cluster } from "@/lib/platform/config";

/** One SOL in lamports. Keeping the amount fixed makes the UI and rate-limit cost explicit. */
export const FAUCET_LAMPORTS = 1_000_000_000;
export const FAUCET_SOL = 1;

export type FaucetErrorCode =
  | "unsupported_cluster"
  | "invalid_address"
  | "rate_limited"
  | "rpc_unavailable"
  | "rpc_rejected"
  | "invalid_response"
  | "transaction_failed"
  | "confirmation_timeout";

export class FaucetError extends Error {
  constructor(
    readonly code: FaucetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FaucetError";
  }
}

interface RpcEnvelope {
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

interface RpcOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function rpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  { signal, fetcher = fetch }: RpcOptions = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new FaucetError(
      "rpc_unavailable",
      error instanceof Error ? error.message : "The RPC endpoint could not be reached.",
    );
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new FaucetError("rate_limited", "The faucet rate limit was reached.");
    }
    throw new FaucetError("rpc_unavailable", `${method} returned HTTP ${response.status}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FaucetError("invalid_response", `${method} returned invalid JSON.`);
  }

  if (!isRecord(body)) {
    throw new FaucetError("invalid_response", `${method} returned an invalid response.`);
  }

  const envelope = body as RpcEnvelope;
  if (envelope.error !== undefined) {
    const message =
      isRecord(envelope.error) && typeof envelope.error.message === "string"
        ? envelope.error.message
        : "The RPC endpoint rejected the request.";
    throw new FaucetError("rpc_rejected", message);
  }
  if (!("result" in envelope)) {
    throw new FaucetError("invalid_response", `${method} returned no result.`);
  }

  return envelope.result;
}

function isValidSignature(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return decodeBase58(value).length === 64;
  } catch {
    return false;
  }
}

export interface RequestAirdropOptions extends RpcOptions {
  cluster: Cluster;
  rpcUrl: string;
  address: string;
}

/**
 * Requests exactly one devnet SOL. There is deliberately no mainnet fallback: a
 * faucet has no place in a production-money flow, even when an RPC URL is mistyped.
 */
export async function requestDevnetAirdrop({
  cluster,
  rpcUrl,
  address,
  signal,
  fetcher,
}: RequestAirdropOptions): Promise<string> {
  if (cluster !== "devnet") {
    throw new FaucetError("unsupported_cluster", "The faucet is only available on devnet.");
  }
  if (!isValidPublicKey(address)) {
    throw new FaucetError("invalid_address", "The destination is not a Solana public key.");
  }

  const signature = await rpc(
    rpcUrl,
    "requestAirdrop",
    [address, FAUCET_LAMPORTS, { commitment: "confirmed" }],
    { signal, fetcher },
  );

  if (!isValidSignature(signature)) {
    throw new FaucetError("invalid_response", "The faucet returned an invalid transaction signature.");
  }
  return signature;
}

interface ConfirmationOptions extends RpcOptions {
  rpcUrl: string;
  signature: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseConfirmation(result: unknown): "pending" | "confirmed" {
  if (!isRecord(result) || !Array.isArray(result.value)) {
    throw new FaucetError("invalid_response", "getSignatureStatuses returned an invalid response.");
  }

  const status = result.value[0];
  if (status === null) return "pending";
  if (!isRecord(status) || !("err" in status)) {
    throw new FaucetError("invalid_response", "getSignatureStatuses returned an invalid status.");
  }
  if (status.err !== null) {
    throw new FaucetError("transaction_failed", JSON.stringify(status.err));
  }

  return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized"
    ? "confirmed"
    : "pending";
}

/** Polls the signature status for roughly 45 seconds by default. */
export async function waitForAirdropConfirmation({
  rpcUrl,
  signature,
  signal,
  fetcher,
  pollIntervalMs = 1_500,
  maxAttempts = 30,
}: ConfirmationOptions): Promise<void> {
  if (!isValidSignature(signature)) {
    throw new FaucetError("invalid_response", "The airdrop signature is invalid.");
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await rpc(
      rpcUrl,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
      { signal, fetcher },
    );
    if (parseConfirmation(result) === "confirmed") return;
    if (attempt < maxAttempts - 1) await delay(pollIntervalMs, signal);
  }

  throw new FaucetError(
    "confirmation_timeout",
    "The request was submitted but was not confirmed before the timeout.",
  );
}

export function devnetTransactionUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
