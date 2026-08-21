/**
 * Which world the app is talking to.
 *
 * Demo unless an RPC endpoint is configured, and demo even then while the program
 * id is still Anchor's placeholder. The second condition is the one that matters:
 * pointing at a real cluster does not make a guard exist, and an app that behaves
 * as though it does would show an empty panel and let the user conclude their
 * position is unprotected for the wrong reason.
 */

import { PROGRAM_ID, PROGRAM_IS_DEPLOYED } from "@/lib/core/program";
import type { PlatformMode } from "@/lib/platform/types";

export interface PlatformConfig {
  mode: PlatformMode;
  rpcUrl: string | null;
  programId: string;
  /** Why the app is in demo mode, when it is. Shown, not swallowed. */
  demoReason: "not_configured" | "program_not_deployed" | null;
}

export function readConfig(): PlatformConfig {
  const rpcUrl = process.env.NEXT_PUBLIC_BRACE_RPC_URL?.trim() || null;
  const programId = process.env.NEXT_PUBLIC_BRACE_PROGRAM_ID?.trim() || PROGRAM_ID;

  if (rpcUrl === null) {
    return { mode: "demo", rpcUrl: null, programId, demoReason: "not_configured" };
  }
  if (!PROGRAM_IS_DEPLOYED && programId === PROGRAM_ID) {
    return { mode: "demo", rpcUrl, programId, demoReason: "program_not_deployed" };
  }
  return { mode: "chain", rpcUrl, programId, demoReason: null };
}

/**
 * Explorer link for a signature, or null when there is nothing to link to.
 *
 * Returning null rather than a URL is the point. A demo receipt has no transaction,
 * and a link that 404s teaches the user that the receipts are decoration.
 */
export function explorerUrl(config: PlatformConfig, signature: string | null): string | null {
  if (signature === null || config.mode !== "chain") return null;
  return `https://solscan.io/tx/${signature}`;
}

export function programExplorerUrl(config: PlatformConfig): string | null {
  if (!PROGRAM_IS_DEPLOYED) return null;
  return `https://solscan.io/account/${config.programId}`;
}
