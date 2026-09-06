/**
 * The same interface, against a real cluster.
 *
 * Tracking a borrow and acting on one are different privileges, and this file
 * reflects that. Reading a Kamino position needs no Brace write transaction: the
 * obligations are Kamino's accounts. The devnet guard is deployed, so configured
 * wallets can use both the read and owner-signed write paths.
 *
 * What that buys is the thing PLATFORM.md 2.2 is actually about — showing somebody
 * their own position, with their own numbers, before asking them to authorize
 * anything. A guard is attached to a position when one exists and reported as absent
 * when it does not, which is a state the interface has to render either way.
 *
 * Writes report failure as a value rather than a throw, because every one of them
 * has a screen state and none is exceptional. If a deployment is disabled in a
 * future configuration, the same boundary can report that state before opening a
 * wallet prompt.
 */

import {
  decodeGuardConfig,
  guardIdentity,
  looksLikeGuardAccount,
  needsMigration,
} from "@/lib/core/tx/decode";
import { GUARD_ACCOUNT_DISCRIMINATOR, PROGRAM_IS_DEPLOYED } from "@/lib/core/program";
import { encodeBase58 } from "@/lib/core/tx/base58";
import type { Guard } from "@/lib/core/guard";
import {
  decodeMarketName,
  decodeObligation,
  decodeReserve,
  KLEND_PROGRAM_ID,
  OBLIGATION_SIZE,
  O_OWNER,
  toPositionSnapshot,
  type ObligationInfo,
  type ReserveInfo,
} from "@/lib/platform/kamino";
import type { PlatformConfig } from "@/lib/platform/config";
import { Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  depositReserveIx,
  initGuardIx,
  migrateGuardIx,
  ownerRepayIx,
  revokeIx,
  updatePolicyIx,
  withdrawReserveIx,
  type GuardAccounts,
} from "@/lib/platform/guard-tx";
import { DEVNET_MARKET, planRefresh } from "@/lib/platform/devnet-market";
import { REPAY_ALL, WITHDRAW_ALL } from "@/lib/core/tx/instructions";
import { validatePolicy, withSchedule } from "@/lib/core/policy";
import type { DiscoveredPosition, Failure, GuardSource, Outcome, Snapshot } from "@/lib/platform/types";

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
    if (response.status === 429) {
      throw new SourceError({
        kind: "rpc_rate_limited",
        detail: "This endpoint is rate limiting requests. Set NEXT_PUBLIC_BRACE_RPC_URL to a dedicated RPC.",
      });
    }
    throw new SourceError({
      kind: "rpc_request_failed",
      method,
      code: response.status,
      detail: `${method} returned HTTP ${response.status}`,
    });
  }

  let body: RpcResponse<T>;
  try {
    body = (await response.json()) as RpcResponse<T>;
  } catch {
    throw new SourceError({ kind: "rpc_invalid_response", method, detail: "The response was not valid JSON." });
  }
  if (body.error) {
    throw new SourceError({
      kind: "rpc_request_failed",
      method,
      code: body.error.code,
      detail: body.error.message,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(body, "result")) {
    throw new SourceError({ kind: "rpc_invalid_response", method, detail: "The response did not include a result." });
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
 * Every Kamino obligation this address owns, across every market.
 *
 * Filtered server side on the account size and on the owner at offset 64. Without
 * the owner filter this downloads every position on the protocol.
 */
export async function fetchObligations(
  config: PlatformConfig,
  owner: string,
): Promise<ObligationInfo[]> {
  const accounts = await rpc<ProgramAccount[]>(config.rpcUrl, "getProgramAccounts", [
    KLEND_PROGRAM_ID,
    {
      encoding: "base64",
      filters: [{ dataSize: OBLIGATION_SIZE }, { memcmp: { offset: O_OWNER, bytes: owner } }],
      commitment: "confirmed",
    },
  ]);

  return accounts.flatMap((account) => {
    try {
      return [decodeObligation(account.pubkey, base64ToBytes(account.account.data[0]))];
    } catch {
      // A layout the decoder does not recognise is skipped rather than thrown: one
      // unreadable position must not blank out the others.
      return [];
    }
  });
}

interface MaybeAccount {
  data: [string, string];
}

async function fetchAccounts(
  config: PlatformConfig,
  keys: string[],
): Promise<Map<string, Uint8Array>> {
  const found = new Map<string, Uint8Array>();
  // getMultipleAccounts caps at 100 keys per call.
  for (let index = 0; index < keys.length; index += 100) {
    const batch = keys.slice(index, index + 100);
    const values = await rpc<{ value: (MaybeAccount | null)[] }>(
      config.rpcUrl,
      "getMultipleAccounts",
      [batch, { encoding: "base64", commitment: "confirmed" }],
    );
    batch.forEach((key, position) => {
      const account = values.value[position];
      if (account) found.set(key, base64ToBytes(account.data[0]));
    });
  }
  return found;
}

export async function fetchReserves(
  config: PlatformConfig,
  keys: string[],
): Promise<Map<string, ReserveInfo>> {
  const reserves = new Map<string, ReserveInfo>();
  for (const [key, bytes] of await fetchAccounts(config, keys)) {
    try {
      reserves.set(key, decodeReserve(key, bytes));
    } catch {
      // Same reasoning: an unreadable reserve costs a symbol and a price, not the
      // whole snapshot.
    }
  }
  return reserves;
}

/** The owner's guards, or none when the selected position has no authorization. */
export async function fetchGuards(config: PlatformConfig, owner: string): Promise<Guard[]> {
  if (!PROGRAM_IS_DEPLOYED) return [];

  const accounts = await rpc<ProgramAccount[]>(config.rpcUrl, "getProgramAccounts", [
    config.programId,
    {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0, bytes: encodeBase58(new Uint8Array(GUARD_ACCOUNT_DISCRIMINATOR)) } },
        { memcmp: { offset: 8, bytes: owner } },
      ],
      commitment: "confirmed",
    },
  ]);

  return accounts
    .map((account) => ({ pubkey: account.pubkey, bytes: base64ToBytes(account.account.data[0]) }))
    .filter((account) => looksLikeGuardAccount(account.bytes))
    // A previous-layout account is a live authorization this reader cannot parse,
    // not a guard that is absent. It comes back from `fetchStrandedGuards` instead,
    // so the interface offers to restore it rather than offering to create a second
    // one at an address that is already taken.
    .filter((account) => !needsMigration(account.bytes))
    .map((account) => decodeGuardConfig(account.pubkey, account.bytes));
}

/** Guards written by a previous program, by the obligation each one watches. */
export async function fetchStrandedGuards(
  config: PlatformConfig,
  owner: string,
): Promise<Set<string>> {
  if (!PROGRAM_IS_DEPLOYED) return new Set();

  const accounts = await rpc<ProgramAccount[]>(config.rpcUrl, "getProgramAccounts", [
    config.programId,
    {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0, bytes: encodeBase58(new Uint8Array(GUARD_ACCOUNT_DISCRIMINATOR)) } },
        { memcmp: { offset: 8, bytes: owner } },
      ],
      commitment: "confirmed",
    },
  ]);

  return new Set(
    accounts
      .map((account) => ({ pubkey: account.pubkey, bytes: base64ToBytes(account.account.data[0]) }))
      .filter((account) => needsMigration(account.bytes))
      .map((account) => guardIdentity(account.pubkey, account.bytes).obligation),
  );
}

export async function fetchTokenBalance(
  config: PlatformConfig,
  tokenAccount: string,
): Promise<bigint> {
  const balance = await rpc<{ value: { amount: string } }>(
    config.rpcUrl,
    "getTokenAccountBalance",
    [tokenAccount, { commitment: "confirmed" }],
  );
  return BigInt(balance.value.amount);
}

interface TokenAccounts {
  value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
}

/**
 * What the owner holds of `mint`, summed over their token accounts.
 *
 * Summed rather than read from the associated account alone, because a wallet can
 * legitimately hold one mint in several accounts and showing the smaller number
 * would tell somebody they cannot fund a reserve that they can.
 */
async function fetchWalletBalance(
  config: PlatformConfig,
  owner: string,
  mint: string,
): Promise<bigint> {
  const accounts = await rpc<TokenAccounts>(config.rpcUrl, "getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  return accounts.value.reduce(
    (total, entry) => total + BigInt(entry.account.data.parsed.info.tokenAmount.amount),
    0n,
  );
}

const NOT_DEPLOYED: Outcome = { ok: false, failure: { kind: "program_not_deployed" } };

/**
 * Whatever can put a signature on a transaction.
 *
 * Structural rather than a wallet type, so this module stays testable and the source
 * does not care whether the signature came from Phantom or from a script.
 */
export interface Signer {
  address: string;
  signAndSend(transaction: Transaction): Promise<string>;
}

/**
 * Resolves the accounts every guard instruction needs from the obligation alone.
 *
 * The vault mint has to be the debt reserve's liquidity mint — `init_guard` checks
 * it — so it is read off chain rather than chosen here.
 */
async function guardAccountsFor(
  config: PlatformConfig,
  owner: string,
  obligationAddress: string,
): Promise<GuardAccounts | Failure> {
  const obligations = await fetchObligations(config, owner);
  const obligation = obligations.find((entry) => entry.address === obligationAddress);
  if (!obligation) {
    return { kind: "position_not_found", detail: "That position is not owned by this address." };
  }

  const borrow = obligation.borrows[0];
  if (!borrow) {
    return { kind: "position_not_found", detail: "That position has no borrow for the agent to repay." };
  }

  const reserves = await fetchReserves(config, [borrow.reserve]);
  const reserve = reserves.get(borrow.reserve);
  if (!reserve) {
    return { kind: "reserve_not_found", detail: "The debt reserve could not be read." };
  }

  return {
    owner: new PublicKey(owner),
    obligation: new PublicKey(obligation.address),
    lendingMarket: new PublicKey(obligation.lendingMarket),
    debtReserve: new PublicKey(borrow.reserve),
    vaultMint: new PublicKey(reserve.mint),
  };
}

export function createChainSource(config: PlatformConfig, signer: Signer | null = null): GuardSource {
  /** Signs one instruction and reports the outcome as a value, never a throw. */
  async function send(build: (accounts: GuardAccounts) => TransactionInstruction, obligation: string): Promise<Outcome> {
    if (!PROGRAM_IS_DEPLOYED) return NOT_DEPLOYED;
    if (signer === null) return { ok: false, failure: { kind: "wallet_unavailable" } };

    try {
      const accounts = await guardAccountsFor(config, signer.address, obligation);
      if (!("owner" in accounts)) return { ok: false, failure: accounts };

      const connection = new Connection(config.rpcUrl, "confirmed");
      const transaction = new Transaction().add(build(accounts));
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = accounts.owner;

      const signature = await signer.signAndSend(transaction);
      await connection.confirmTransaction(signature, "confirmed");
      return { ok: true, signature };
    } catch (error) {
      return { ok: false, failure: asWriteFailure(error) };
    }
  }

  async function snapshot(owner: string): Promise<Snapshot> {
    const obligations = await fetchObligations(config, owner);

    const reserveKeys = [
      ...new Set(
        obligations.flatMap((obligation) => [
          ...obligation.deposits.map((entry) => entry.reserve),
          ...obligation.borrows.map((entry) => entry.reserve),
        ]),
      ),
    ];
    const marketKeys = [...new Set(obligations.map((obligation) => obligation.lendingMarket))];

    const [reserves, markets, guards, stranded] = await Promise.all([
      fetchReserves(config, reserveKeys),
      fetchAccounts(config, marketKeys),
      fetchGuards(config, owner),
      fetchStrandedGuards(config, owner),
    ]);

    const positions: DiscoveredPosition[] = obligations.map((obligation) => {
      const marketBytes = markets.get(obligation.lendingMarket);
      const position = toPositionSnapshot(
        obligation,
        reserves,
        marketBytes ? decodeMarketName(marketBytes) : "",
      );
      // The guard repays debt, so a position without any is not something it can
      // help with. That is a different answer from "no positions found", and the
      // interface owes the reader the difference.
      const supported = obligation.borrows.length > 0;

      return {
        position,
        supported,
        unsupportedReason: supported
          ? undefined
          : "This position holds collateral but has no borrow, so there is no debt for the agent to repay.",
        guard: guards.find((candidate) => candidate.obligation === obligation.address) ?? null,
        guardNeedsMigration: stranded.has(obligation.address),
      };
    });

    const first = positions.find((entry) => entry.supported);
    const firstObligation = obligations.find(
      (obligation) => obligation.address === first?.position.obligation,
    );
    const debtMint = firstObligation
      ? reserves.get(firstObligation.borrows[0]?.reserve ?? "")?.mint
      : undefined;

    const [reserveBalance, walletBalance] = await Promise.all([
      first?.guard ? fetchTokenBalance(config, first.guard.vault) : Promise.resolve(0n),
      debtMint ? fetchWalletBalance(config, owner, debtMint) : Promise.resolve(0n),
    ]);

    return {
      now: Math.floor(Date.now() / 1000),
      owner,
      positions,
      reserveBalance,
      walletBalance,
      // No watcher runs against this cluster yet. Reporting null rather than a
      // timestamp is what makes the panel say "unknown" instead of "healthy".
      watcherLastCheckAt: null,
      receipts: [],
    };
  }

  return {
    mode: "chain",
    canWrite: PROGRAM_IS_DEPLOYED && signer !== null,
    snapshot,
    async authorize({ obligation, policy }) {
      // Checked here rather than only on the screen, so every caller gets the
      // same answer. Building the instruction anyway costs the user a wallet
      // prompt that the wallet has already simulated and knows will fail.
      const existing = await fetchGuards(config, signer?.address ?? "").catch(() => []);
      const guard = existing.find((candidate) => candidate.obligation === obligation);
      if (guard) return { ok: false, failure: { kind: "guard_exists", guard: guard.address } };

      const agent = new PublicKey(DEVNET_MARKET.agent);
      return send((accounts) => initGuardIx(accounts, agent, policy), obligation);
    },

    async deposit({ obligation, amount }) {
      return send((accounts) => depositReserveIx(accounts, amount), obligation);
    },

    async withdraw({ obligation, amount }) {
      // `null` means the whole vault, expressed with the program's own sentinel so
      // the amount does not have to be read first and cannot go stale between.
      return send(
        (accounts) => withdrawReserveIx(accounts, amount ?? WITHDRAW_ALL),
        obligation,
      );
    },

    async setPaused({ obligation, paused }) {
      if (signer === null) return { ok: false, failure: { kind: "wallet_unavailable" } };

      // `update_policy` rewrites the whole record, so pausing means re-sending the
      // policy that is already there. Reading it first is what keeps a pause from
      // quietly resetting somebody's limits.
      const guards = await fetchGuards(config, signer.address);
      const guard = guards.find((candidate) => candidate.obligation === obligation);
      if (!guard) {
        return { ok: false, failure: { kind: "guard_not_found", detail: "No authorization on that position." } };
      }

      return send(
        (accounts) => updatePolicyIx(accounts, new PublicKey(guard.agent), guard.policy, paused),
        obligation,
      );
    },

    async revoke({ obligation }) {
      return send((accounts) => revokeIx(accounts), obligation);
    },

    async migrateGuard({ obligation }) {
      return send((accounts) => migrateGuardIx(accounts), obligation);
    },

    async setSchedule({ obligation, schedule }) {
      if (signer === null) return { ok: false, failure: { kind: "wallet_unavailable" } };

      // Same shape as `setPaused`, and for the same reason: `update_policy` rewrites
      // the record, so the policy already on chain has to be read first or changing
      // the schedule would quietly reset somebody's limits.
      const guards = await fetchGuards(config, signer.address);
      const guard = guards.find((candidate) => candidate.obligation === obligation);
      if (!guard) {
        return { ok: false, failure: { kind: "guard_not_found", detail: "No authorization on that position." } };
      }

      const policy = withSchedule(guard.policy, schedule);
      const problems = validatePolicy(policy, { now: Math.floor(Date.now() / 1000) });
      if (problems.length > 0) {
        return {
          ok: false,
          failure: { kind: "invalid_policy", messages: problems.map((problem) => problem.message) },
        };
      }

      return send(
        (accounts) => updatePolicyIx(accounts, new PublicKey(guard.agent), policy, guard.paused),
        obligation,
      );
    },

    async repayNow({ obligation, amount }) {
      if (!PROGRAM_IS_DEPLOYED) return NOT_DEPLOYED;
      if (signer === null) return { ok: false, failure: { kind: "wallet_unavailable" } };

      try {
        const accounts = await guardAccountsFor(config, signer.address, obligation);
        if (!("owner" in accounts)) return { ok: false, failure: accounts };

        const connection = new Connection(config.rpcUrl, "confirmed");

        // Unlike every other write here, this one cannot be a single instruction.
        // The program refuses an obligation staler than two slots, so the refresh
        // has to ride in the same transaction: a separate one would leave a window
        // where a block lands in between and the repay fails on staleness.
        const refresh = await planRefresh({ connection, owner: accounts.owner });
        if (refresh === null) {
          return {
            ok: false,
            failure: { kind: "position_not_found", detail: "The position could not be read to refresh it." },
          };
        }

        const reserves = await obligationReserves(connection, accounts.obligation);
        const deposits = reserves.filter((reserve) => !reserve.equals(accounts.debtReserve));

        const transaction = new Transaction()
          .add(...refresh.instructions)
          .add(ownerRepayIx(accounts, amount ?? REPAY_ALL, deposits));

        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = accounts.owner;

        const signature = await signer.signAndSend(transaction);
        await connection.confirmTransaction(signature, "confirmed");
        return { ok: true, signature };
      } catch (error) {
        return { ok: false, failure: asWriteFailure(error) };
      }
    },
  };
}

/**
 * Every reserve the obligation references, deposits first, in its own order.
 *
 * Read here rather than taken from the snapshot because the remaining-account list
 * has to match the account as it is at signing time. A snapshot is a second old and
 * the program compares the list position by position.
 */
async function obligationReserves(
  connection: Connection,
  obligation: PublicKey,
): Promise<PublicKey[]> {
  const account = await connection.getAccountInfo(obligation, "confirmed");
  if (account === null) return [];

  const data = account.data;
  const at = (offset: number) => new PublicKey(data.subarray(offset, offset + 32));
  const used = (offset: number) => !data.subarray(offset, offset + 32).every((byte) => byte === 0);

  return [
    ...Array.from({ length: 8 }, (_, index) => 96 + index * 136).filter(used).map(at),
    ...Array.from({ length: 5 }, (_, index) => 1_208 + index * 200).filter(used).map(at),
  ];
}

/**
 * Turns a thrown wallet or RPC error into one of the failures the interface knows.
 *
 * A program error carries its code so the screen can name the rule that stopped it
 * rather than saying "transaction failed".
 */
function asWriteFailure(error: unknown): Failure {
  const message = error instanceof Error ? error.message : String(error);

  if (error !== null && typeof error === "object" && "code" in error && error.code === 4001) {
    return { kind: "wallet_rejected" };
  }

  if (/wallet.*(locked|unlock)|please unlock/i.test(message)) {
    return { kind: "wallet_locked" };
  }
  if (/already processing|request is already pending|device is busy/i.test(message)) {
    return { kind: "wallet_busy" };
  }
  if (/wallet.*(disconnect|disconnected)|walletNotConnected/i.test(message)) {
    return { kind: "wallet_disconnected" };
  }

  // Anchor's `init` on a PDA that already exists fails in the System Program,
  // not in ours, so it never carries a guard error code. Without this it lands
  // in `unknown` and the user is shown whatever the wallet called it.
  if (/already in use|account already exists/i.test(message)) {
    return { kind: "guard_exists", guard: "" };
  }

  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(message);
  if (custom) return { kind: "program_error", code: parseInt(custom[1], 16) };

  if (/blockhash not found|block height exceeded/i.test(message)) {
    return /block height exceeded/i.test(message)
      ? { kind: "confirmation_timeout" }
      : { kind: "congested", retryable: true };
  }
  if (/insufficient funds for fee|insufficient lamports|fee payer/i.test(message)) {
    return { kind: "insufficient_sol", detail: message };
  }
  if (/simulation failed|transaction simulation/i.test(message)) {
    return { kind: "transaction_simulation_failed", detail: message };
  }
  if (/failed to send|send transaction/i.test(message)) {
    return { kind: "transaction_send_failed", detail: message };
  }
  if (/account .*not found|could not find account/i.test(message)) {
    return { kind: "account_not_found" };
  }
  if (/invalid account|invalid .*data|failed to deserialize/i.test(message)) {
    return { kind: "invalid_account_data", detail: message };
  }
  if (/transaction failed|transaction.*err|instruction .*failed/i.test(message)) {
    return { kind: "transaction_failed", detail: message };
  }
  return { kind: "unknown", detail: message };
}
