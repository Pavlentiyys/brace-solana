/**
 * Every external fact about the project in one place, with honest values.
 *
 * LANDING.md section 6 requires the audit status to be stated honestly,
 * including its absence. The same applies to everything else here. A field
 * whose value is not known yet says so; it does not get a plausible
 * placeholder that reads as fact.
 */

import { PROGRAM_ID, PROGRAM_IS_DEPLOYED } from "@/lib/core/program";
import { programExplorerUrl, readConfig } from "@/lib/platform/config";

export const site = {
  name: "Brace",
  /** Used for metadata and OG cards. Set to the real domain before launch. */
  url: "https://brace.fi",
  tagline: "The agent executes your rule when your position moves toward liquidation.",

  /**
   * Derived, never restated. This block held its own copy of the address, and
   * when the program was deployed the copy stayed on Anchor's placeholder — so
   * the footer pointed the public at an address with nothing on it, on the one
   * page whose whole claim is that the guarantees are checkable.
   *
   * `program.test.ts` asserts the id here still equals `PROGRAM_ID`, so a
   * second divergence is a failing test rather than a live page.
   */
  program: {
    id: PROGRAM_ID,
    deployed: PROGRAM_IS_DEPLOYED,
    // Short enough to sit beside the link as a parenthetical, and it has to say
    // "not mainnet": the link alone reads as production.
    status: PROGRAM_IS_DEPLOYED ? "devnet, not mainnet" : "not deployed, localnet only",
    explorerUrl: programExplorerUrl(readConfig()),
  },

  audit: {
    completed: false,
    status: "Not audited.",
    detail: "No audit has been commissioned. This will be updated here when that changes.",
    reportUrl: null as string | null,
  },

  protocol: {
    name: "Kamino",
    url: "https://app.kamino.finance",
  },

  /**
   * TODO: replace with real destinations before the site goes public. Nulls
   * render as plain text with a "not yet" note rather than as dead links.
   */
  links: {
    github: "https://github.com/Pavlentiyys/brace-solana",
    contact: null as string | null,
    status: null as string | null,
    bot: null as string | null,
  },
} as const;
