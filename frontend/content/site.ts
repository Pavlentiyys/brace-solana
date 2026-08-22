/**
 * Every external fact about the project in one place, with honest values.
 *
 * LANDING.md section 6 requires the audit status to be stated honestly,
 * including its absence. The same applies to everything else here. A field
 * whose value is not known yet says so; it does not get a plausible
 * placeholder that reads as fact.
 */

export const site = {
  name: "Brace",
  /** Used for metadata and OG cards. Set to the real domain before launch. */
  url: "https://brace.fi",
  tagline: "The agent executes your rule when your position moves toward liquidation.",

  program: {
    /**
     * Anchor's public placeholder ID. The program has not been deployed, so
     * there is nothing to link to on an explorer yet. `explorerUrl` stays null
     * until a real address exists: a link to a placeholder address would be
     * worse than no link.
     */
    id: "Fg6PaFpoGXkYsidMpWxTWqkZpY6W2BeZ7FEfcYkgMQbS",
    deployed: false,
    status: "Not deployed. Localnet only.",
    explorerUrl: null as string | null,
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
