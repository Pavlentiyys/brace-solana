/**
 * The same interface, against a real cluster.
 *
 * Written now and switched on later. The read path below is the finished article:
 * it fetches the owner's guard accounts with a memcmp on the discriminator and the
 * owner field, decodes them with the shared decoder, and reads the vault balance.
 * The moment `declare_id!` holds a deployed address and `NEXT_PUBLIC_BRACE_RPC_URL`
 * is set, this is what the panel renders from.
 *
 * Two things are deliberately not here.
 *
 * The obligation reader is not: turning a Kamino obligation into the exact
 * `collateralValue` and `debtValue` pair the panel needs means porting the layout in
 * `program/programs/guard/src/adapter/kamino.rs`, and a layout port that cannot be
 * tested against a live account is a guess. It is expressed as `MarketReader` so it
 * can be dropped in and tested on its own.
 *
 * Signing is not: it needs a wallet and a transaction assembler, and neither can be
 * exercised against a program that does not exist. Every write returns
 * `program_not_deployed` rather than opening a wallet prompt that cannot succeed.
 */

import { decodeGuardConfig, looksLikeGuardAccount } from "@/lib/core/tx/decode";
import { GUARD_ACCOUNT_DISCRIMINATOR } from "@/lib/core/program";
import { encodeBase58 } from "@/lib/core/tx/base58";
import type { Guard } from "@/lib/core/guard";
import type { PositionSnapshot } from "@/lib/core/position";
import type { PlatformConfig } from "@/lib/platform/config";
import type { DiscoveredPosition, Failure, GuardSource, Outcome, Snapshot } from "@/lib/platform/types";

/** Anything that can turn an obligation address into the numbers the panel needs. */
export interface MarketReader {
  readPosition(obligation: string): Promise<PositionSnapshot>;
}

export class SourceError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind);
    this.name = "SourceError";
  }
}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (error) {
    // A network failure is a degraded state, not an empty account. Section 6 is
    // explicit that the panel must not render "no positions" when it simply could
    // not ask.
    throw new SourceError({ kind: "rpc_unavailable", detail: (error as Error).message });
  }

  if (!response.ok) {
    throw new SourceError({ kind: "rpc_unavailable", detail: `${method} returned ${response.status}` });
  }

  const body = (await response.json()) as RpcResponse<T>;
  if (body.error) {
    throw new SourceError({ kind: "rpc_unavailable", detail: body.error.message });
  }
  return body.result as T;
}

interface ProgramAccount {
  pubkey: string;
  account: { data: [string, string] };
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The owner's guards.
 *
 * Filtered server side on both the account discriminator and the owner key, which
 * sits at offset 8 as the first field of the struct. Without the owner filter this
 * downloads every guard on the program.
 */
export async function fetchGuards(config: PlatformConfig, owner: string): Promise<Guard[]> {
  const accounts = await rpc<ProgramAccount[]>(config.rpcUrl!, "getProgramAccounts", [
    config.programId,
    {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0, bytes: encodeBase58(new Uint8Array(GUARD_ACCOUNT_DISCRIMINATOR)) } },
        { memcmp: { offset: 8, bytes: owner } },
      ],
    },
  ]);

  return accounts
    .map((account) => ({ pubkey: account.pubkey, bytes: base64ToBytes(account.account.data[0]) }))
    .filter((account) => looksLikeGuardAccount(account.bytes))
    .map((account) => decodeGuardConfig(account.pubkey, account.bytes));
}

interface TokenBalance {
  value: { amount: string };
}

export async function fetchTokenBalance(config: PlatformConfig, tokenAccount: string): Promise<bigint> {
  const balance = await rpc<TokenBalance>(config.rpcUrl!, "getTokenAccountBalance", [tokenAccount]);
  return BigInt(balance.value.amount);
}

const NOT_DEPLOYED: Outcome = { ok: false, failure: { kind: "program_not_deployed" } };

export function createChainSource(config: PlatformConfig, market: MarketReader | null): GuardSource {
  async function snapshot(owner: string): Promise<Snapshot> {
    if (config.rpcUrl === null) {
      throw new SourceError({ kind: "rpc_unavailable", detail: "no endpoint configured" });
    }

    const guards = await fetchGuards(config, owner);
    if (market === null) {
      throw new SourceError({
        kind: "unknown",
        detail:
          "The market reader for Kamino obligations is not implemented yet, so positions cannot be shown against a live cluster.",
      });
    }

    const positions: DiscoveredPosition[] = await Promise.all(
      guards.map(async (guard) => ({
        position: await market.readPosition(guard.obligation),
        supported: true,
        guard,
      })),
    );

    const [first] = guards;
    return {
      now: Math.floor(Date.now() / 1000),
      owner,
      positions,
      reserveBalance: first ? await fetchTokenBalance(config, first.vault) : 0n,
      // The owner's own token account has to be resolved through the associated
      // token program, which is the same missing piece as the market reader.
      walletBalance: 0n,
      watcherLastCheckAt: null,
      receipts: [],
    };
  }

  return {
    mode: "chain",
    canWrite: false,
    snapshot,
    async authorize() {
      return NOT_DEPLOYED;
    },
    async deposit() {
      return NOT_DEPLOYED;
    },
    async withdraw() {
      return NOT_DEPLOYED;
    },
    async setPaused() {
      return NOT_DEPLOYED;
    },
    async revoke() {
      return NOT_DEPLOYED;
    },
  };
}
