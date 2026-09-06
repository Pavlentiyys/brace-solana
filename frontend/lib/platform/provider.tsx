"use client";

/**
 * One provider for the whole app section: which source, which wallet, and the query
 * cache in front of both.
 *
 * Which source is not a configuration switch: it follows the wallet. A real address
 * reads real Kamino positions off the cluster, the demo wallet reads the browser
 * world, and the two never mix. See `world` below.
 */

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { readConfig, type PlatformConfig } from "@/lib/platform/config";
import { createChainSource } from "@/lib/platform/chain-source";
import { demoSource } from "@/lib/platform/demo-source";
import type {
  DiscoveredPosition,
  Failure,
  GuardSource,
  Outcome,
  PlatformMode,
  Snapshot,
} from "@/lib/platform/types";
import {
  demoWallet,
  detectInjectedWallet,
  injectedWallet,
  watchInjectedWallet,
  WalletRejected,
  type WalletPort,
} from "@/lib/platform/wallet";

/**
 * One second against the browser world, fifteen against a cluster.
 *
 * The fast interval exists because PLATFORM.md 2.5 needs a liveness readout able to
 * show a watcher falling behind, and thirty seconds cannot tell "checked 4 seconds
 * ago" from "checked 34". Pointing that same interval at a public RPC endpoint gets
 * the app rate limited within a minute, and a panel that 429s is worse at reporting
 * liveness than one that polls slowly. Against a real cluster the account
 * subscription of section 5 is what makes this interval a fallback rather than the
 * mechanism.
 */
export const SNAPSHOT_INTERVAL_MS = 1_000;
export const CHAIN_SNAPSHOT_INTERVAL_MS = 15_000;

export type WalletStatus = "disconnected" | "connecting" | "connected";

interface PlatformValue {
  config: PlatformConfig;
  /**
   * Which world the screens are reading. Derived from the wallet, not from config:
   * `config.mode` says what the deployment could support, this says what is
   * actually on screen right now.
   */
  world: PlatformMode;
  source: GuardSource;
  wallet: WalletPort;
  status: WalletStatus;
  address: string | null;
  /** Set when the last connect attempt failed, cleared when the next one starts. */
  walletFailure: Failure | null;
  /** True once a browser wallet has been found. False during the first moments. */
  injectedAvailable: boolean;
  /** Falls back to the demo wallet, for reviewers without an extension installed. */
  useDemoWallet: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Obligation the panel is showing. `null` means "the first supported one", which
   * is resolved against the snapshot rather than stored, so a selection cannot
   * survive the position it pointed at disappearing.
   */
  selected: string | null;
  select: (obligation: string | null) => void;
}

const PlatformContext = createContext<PlatformValue | null>(null);

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The panel is a live readout. A cached answer from thirty seconds ago is
        // the exact failure mode the liveness indicator exists to catch.
        staleTime: 0,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createClient);
  const config = useMemo(() => readConfig(), []);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [address, setAddress] = useState<string | null>(null);
  const [walletFailure, setWalletFailure] = useState<Failure | null>(null);
  const [selected, select] = useState<string | null>(null);

  // Which port, decided independently of which data source. A real address against
  // the demo world is the intended pairing until the program is deployed.
  const [injectedAvailable, setInjectedAvailable] = useState(false);
  const [preferDemo, setPreferDemo] = useState(false);
  const wallet = !preferDemo && injectedAvailable ? injectedWallet : demoWallet;

  /**
   * The world follows the wallet, and that is the whole design.
   *
   * A real address gets real Kamino positions read off the cluster; the demo wallet
   * gets the browser world. Anything else is incoherent — a fabricated position
   * under somebody's own address is the one combination that could mislead them
   * about their own money.
   */
  const world: PlatformMode = wallet.kind === "injected" ? "chain" : "demo";
  /**
   * The signer is part of the source, not a separate concern: a chain source without
   * one can read but not write, and `canWrite` is what the screens branch on.
   */
  const source = useMemo(
    () =>
      world === "demo"
        ? demoSource
        : createChainSource(
            config,
            address === null
              ? null
              : { address, signAndSend: (transaction) => wallet.signAndSend(transaction) },
          ),
    [world, config, address, wallet],
  );

  // Extensions inject on their own schedule, usually after hydration, so this polls
  // briefly rather than deciding on first render that nothing is installed.
  useEffect(() => detectInjectedWallet(() => setInjectedAvailable(true)), []);

  // Reconnect silently when this site was already approved, and follow the wallet
  // when the user switches account or disconnects from the extension itself.
  useEffect(() => {
    if (!injectedAvailable || preferDemo) return;

    let cancelled = false;
    void injectedWallet.eagerConnect().then((trusted) => {
      if (!cancelled && trusted !== null) {
        setAddress(trusted);
        setStatus("connected");
      }
    });

    const unwatch = watchInjectedWallet((next) => {
      setAddress(next);
      setStatus(next === null ? "disconnected" : "connected");
      if (next === null) select(null);
      client.clear();
    });

    return () => {
      cancelled = true;
      unwatch();
    };
  }, [injectedAvailable, preferDemo, client]);

  function useDemoWallet() {
    setPreferDemo(true);
    setWalletFailure(null);
  }

  async function connect() {
    setWalletFailure(null);

    if (!wallet.available()) {
      setWalletFailure({ kind: "wallet_unavailable" });
      return;
    }

    setStatus("connecting");
    try {
      setAddress(await wallet.connect());
      setStatus("connected");
    } catch (error) {
      setStatus("disconnected");
      setWalletFailure(
        error instanceof WalletRejected
          ? { kind: "wallet_rejected" }
          : { kind: "unknown", detail: (error as Error).message },
      );
    }
  }

  async function disconnect() {
    await wallet.disconnect();
    setAddress(null);
    setStatus("disconnected");
    select(null);
    client.clear();
  }

  const value: PlatformValue = {
    config,
    world,
    source,
    wallet,
    status,
    address,
    walletFailure,
    injectedAvailable,
    useDemoWallet,
    connect,
    disconnect,
    selected,
    select,
  };

  return (
    <QueryClientProvider client={client}>
      <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
}

export function usePlatform(): PlatformValue {
  const value = useContext(PlatformContext);
  if (!value) throw new Error("usePlatform is only available inside PlatformProvider");
  return value;
}

export const SNAPSHOT_KEY = "snapshot";

export interface SnapshotQuery {
  snapshot: Snapshot | null;
  /** Set when the source could not be read at all. The panel degrades on this. */
  failure: Failure | null;
  isLoading: boolean;
  /** The last snapshot that did arrive, so a blip does not blank the screen. */
  isStale: boolean;
}

/**
 * The panel's single read.
 *
 * A failed refetch keeps the previous data and reports `isStale`, because a panel
 * that empties itself on one dropped request tells the user their position vanished.
 */
export function useSnapshot(): SnapshotQuery {
  const { source, address } = usePlatform();

  const query = useQuery({
    queryKey: [SNAPSHOT_KEY, source.mode, address],
    enabled: address !== null,
    refetchInterval: source.mode === "demo" ? SNAPSHOT_INTERVAL_MS : CHAIN_SNAPSHOT_INTERVAL_MS,
    queryFn: () => source.snapshot(address!),
  });

  return {
    snapshot: query.data ?? null,
    failure: query.error ? asFailure(query.error) : null,
    isLoading: query.isLoading,
    isStale: query.isError && query.data !== undefined,
  };
}

export interface SelectedPosition extends SnapshotQuery {
  /** The position the panel is about, or null when there is not one to show. */
  entry: DiscoveredPosition | null;
}

/**
 * The snapshot plus whichever position the panel is pointed at.
 *
 * Resolution order is explicit selection, then the first supported position. A
 * selection that no longer matches anything falls back rather than rendering an
 * empty panel, because the position going away is itself worth showing on screen and
 * a blank page does not do that.
 */
export function useSelectedPosition(): SelectedPosition {
  const { selected } = usePlatform();
  const query = useSnapshot();

  const positions = query.snapshot?.positions ?? [];
  const entry =
    positions.find((candidate) => candidate.position.obligation === selected) ??
    positions.find((candidate) => candidate.supported) ??
    null;

  return { ...query, entry };
}

function asFailure(error: unknown): Failure {
  const failure = (error as { failure?: Failure }).failure;
  if (failure) return failure;

  const kind = (error as { failureKind?: string }).failureKind;
  if (kind === "rpc_unavailable") return { kind: "rpc_unavailable" };

  const message = (error as Error).message ?? String(error);
  if (/wallet.*(locked|unlock)|please unlock/i.test(message)) return { kind: "wallet_locked" };
  if (/already processing|request is already pending|device is busy/i.test(message)) {
    return { kind: "wallet_busy" };
  }
  if (/wallet.*(disconnect|disconnected)|walletNotConnected/i.test(message)) {
    return { kind: "wallet_disconnected" };
  }

  return { kind: "unknown", detail: message };
}

/**
 * Runs one write and refreshes the panel afterwards.
 *
 * Failures come back as values rather than thrown, because every one of them has a
 * screen state in section 6 and none of them is exceptional.
 */
export function useGuardAction(action: (source: GuardSource) => Promise<Outcome>) {
  const { source } = usePlatform();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<Outcome> => {
      try {
        return await action(source);
      } catch (error) {
        return { ok: false, failure: asFailure(error) };
      }
    },
    // Invalidate first so cached data is marked stale, then wait for the active
    // snapshot to be fetched before releasing the pending state. Without the
    // explicit refetch, the panel could keep showing the pre-transaction values
    // until the next interval or a full page reload.
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: [SNAPSHOT_KEY] });
      await client.refetchQueries({ queryKey: [SNAPSHOT_KEY], type: "active" });
    },
  });
}
