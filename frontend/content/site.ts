/**
 * Every external fact about the project in one place, with honest values.
 *
 * Everything external lives here so the footer and metadata share one source.
 */

import { PROGRAM_ID, PROGRAM_IS_DEPLOYED } from "@/lib/core/program";
import { programExplorerUrl, readConfig } from "@/lib/platform/config";

export const site = {
  name: "Brace",
  /** Used for metadata and OG cards. The live deployment. */
  url: "https://brace.best",
  tagline: "The agent executes your rule when your position moves toward liquidation.",

  /**
   * Derived, never restated. This block owns the address used by the footer and
   * metadata. Keeping it derived from the program constants prevents the public
   * site from pointing at a stale deployment address.
   *
   * `program.test.ts` asserts the id here still equals `PROGRAM_ID`, so a
   * second divergence is a failing test rather than a live page.
   */
  program: {
    id: PROGRAM_ID,
    deployed: PROGRAM_IS_DEPLOYED,
    // Structured data for callers that need to distinguish devnet from mainnet.
    // The footer does not expose this internal deployment detail.
    status: PROGRAM_IS_DEPLOYED ? "devnet, not mainnet" : "not deployed, localnet only",
    explorerUrl: programExplorerUrl(readConfig()),
  },

  protocol: {
    name: "Kamino",
    url: "https://app.kamino.finance",
  },

  /**
   * Keep contact destinations in one place so they are easy to update.
   */
  links: {
    github: "https://github.com/Pavlentiyys/brace-solana",
    bot: null as string | null,
  },
} as const;
