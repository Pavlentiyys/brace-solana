"use client";

/**
 * One provider for the whole app section: which source, which wallet, and the query
 * cache in front of both.
 *
 * The polling interval is one second and that is not a placeholder. PLATFORM.md 2.5
 * requires a liveness readout accurate enough to show a watcher falling behind, and
 * a panel that refreshes every thirty seconds cannot distinguish "checked 4 seconds
 * ago" from "checked 34 seconds ago". Against a real cluster the same query gets
 * invalidated by the account subscription instead, which is what section 5 means by
 * invalidation over WebSocket; the interval stays as the fallback for when the
 * socket is the thing that died.
 */

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { readConfig, type PlatformConfig } from "@/lib/platform/config";
import { createChainSource } from "@/lib/platform/chain-source";
import { demoSource } from "@/lib/platform/demo-source";
import type { DiscoveredPosition, Failure, GuardSource, Outcome, Snapshot } from "@/lib/platform/types";
import { demoWallet, injectedWallet, WalletRejected, type WalletPort } from "@/lib/platform/wallet";

export const SNAPSHOT_INTERVAL_MS = 1_000;

export type WalletStatus = "disconnected" | "connecting" | "connected";

interface PlatformValue {
  config: PlatformConfig;
  source: GuardSource;
  wallet: WalletPort;
  status: WalletStatus;
  address: string | null;
  /** Set when the last connect attempt failed, cleared when the next one starts. */
  walletFailure: Failure | null;
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
  const source = useMemo(
    () => (config.mode === "demo" ? demoSource : createChainSource(config, null)),
    [config],
  );
  const wallet = config.mode === "demo" ? demoWallet : injectedWallet;

  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [address, setAddress] = useState<string | null>(null);
  const [walletFailure, setWalletFailure] = useState<Failure | null>(null);
  const [selected, select] = useState<string | null>(null);

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
    source,
    wallet,
    status,
    address,
    walletFailure,
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
    refetchInterval: SNAPSHOT_INTERVAL_MS,
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

  return { kind: "unknown", detail: (error as Error).message ?? String(error) };
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
    onSettled: () => client.invalidateQueries({ queryKey: [SNAPSHOT_KEY] }),
  });
}
