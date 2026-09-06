/**
 * Which world the app is talking to, and on which cluster.
 *
 * These are two questions, not one. The *cluster* is where a wallet signs and where
 * an explorer link points; the *mode* is whether the panel's numbers come from a
 * chain or from the browser. The app can legitimately be on devnet with a real
 * Phantom address while the panel still runs the demo world, and conflating the two
 * is what made connecting hand back a hardcoded address.
 *
 * Mode is demo unless an RPC endpoint is configured, and demo even then when the
 * configured program is not deployed. Pointing at a real cluster does not make a
 * guard exist, and an app that behaves as though it does would show an empty panel
 * and let the user conclude their position is unprotected for the wrong reason.
 */

import { PROGRAM_ID, PROGRAM_IS_DEPLOYED } from "@/lib/core/program";
import type { PlatformMode } from "@/lib/platform/types";

export type Cluster = "devnet" | "testnet" | "mainnet-beta";

/**
 * Devnet, deliberately. The program is deployed on devnet, and a default of mainnet
 * would mean the first wallet prompt a developer sees is one against real funds.
 */
export const DEFAULT_CLUSTER: Cluster = "devnet";

const CLUSTER_RPC: Record<Cluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

const CLUSTER_LABEL: Record<Cluster, string> = {
  devnet: "Devnet",
  testnet: "Testnet",
  "mainnet-beta": "Mainnet",
};

export interface PlatformConfig {
  mode: PlatformMode;
  cluster: Cluster;
  clusterLabel: string;
  /** Where reads go. Defaults to the cluster's public endpoint. */
  rpcUrl: string;
  /** True when the endpoint came from configuration rather than the default. */
  rpcConfigured: boolean;
  programId: string;
  /** Why the app is in demo mode, when it is. Shown, not swallowed. */
  demoReason: "not_configured" | "program_not_deployed" | null;
}

function parseCluster(value: string | undefined): Cluster | null {
  const cluster = value?.trim();
  return cluster === "devnet" || cluster === "testnet" || cluster === "mainnet-beta"
    ? cluster
    : null;
}

export function readConfig(): PlatformConfig {
  const cluster = parseCluster(process.env.NEXT_PUBLIC_BRACE_CLUSTER) ?? DEFAULT_CLUSTER;
  const configuredRpc = process.env.NEXT_PUBLIC_BRACE_RPC_URL?.trim() || null;
  const programId = process.env.NEXT_PUBLIC_BRACE_PROGRAM_ID?.trim() || PROGRAM_ID;

  const base = {
    cluster,
    clusterLabel: CLUSTER_LABEL[cluster],
    rpcUrl: configuredRpc ?? CLUSTER_RPC[cluster],
    rpcConfigured: configuredRpc !== null,
    programId,
  };

  if (configuredRpc === null) {
    return { ...base, mode: "demo", demoReason: "not_configured" };
  }
  if (!PROGRAM_IS_DEPLOYED && programId === PROGRAM_ID) {
    return { ...base, mode: "demo", demoReason: "program_not_deployed" };
  }
  return { ...base, mode: "chain", demoReason: null };
}

/** Solscan needs the cluster spelled out for everything except mainnet. */
function clusterQuery(config: PlatformConfig): string {
  return config.cluster === "mainnet-beta" ? "" : `?cluster=${config.cluster}`;
}

/**
 * Explorer link for a signature, or null when there is nothing to link to.
 *
 * Returning null rather than a URL is the point. A demo receipt has no transaction,
 * and a link that 404s teaches the user that the receipts are decoration.
 */
export function explorerUrl(config: PlatformConfig, signature: string | null): string | null {
  if (signature === null || config.mode !== "chain") return null;
  return `https://solscan.io/tx/${signature}${clusterQuery(config)}`;
}

export function programExplorerUrl(config: PlatformConfig): string | null {
  if (!PROGRAM_IS_DEPLOYED) return null;
  return `https://solscan.io/account/${config.programId}${clusterQuery(config)}`;
}

/** Explorer link for a connected wallet, which exists on every cluster. */
export function addressExplorerUrl(config: PlatformConfig, address: string): string {
  return `https://solscan.io/account/${address}${clusterQuery(config)}`;
}
