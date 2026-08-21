/**
 * Every visible string on the landing page.
 *
 * Kept out of the components so that a second locale is a copy of this file
 * rather than a pass over the markup. LANDING.md section 5 puts English first
 * and Russian second, so English lives at `/` with no prefix.
 *
 * Tone rules from LANDING.md section 4, which this file is the enforcement
 * point for:
 *   - Numbers instead of adjectives. Not "fast", but "under 4 seconds".
 *   - No promises of yield, no guarantees of safety, no "sleep soundly".
 *   - An action has ONE name. If the button says "Revoke authorization", then
 *     the docs and the bot say "Revoke authorization" too.
 *   - No em-dashes anywhere.
 */

export const en = {
  nav: {
    simulator: "Simulator",
    limits: "Limits",
    price: "Price",
    docs: "Docs",
    skipToContent: "Skip to content",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },

  hero: {
    // Two lines at desktop. The longer phrasing ("moves toward liquidation")
    // ran to three, and a three-line hero headline is a font-size or a
    // copy-length error, never an acceptable default.
    headline: "The agent executes your rule as your position nears liquidation.",
    // The answer to "will you take my money" has to be readable without
    // scrolling. LANDING.md section 1 puts this above everything else.
    subheadline:
      "It adds collateral or repays debt from your reserve. It cannot send funds anywhere else.",
    cta: "Model your position",
    readout: {
      title: "Example position",
      collateral: "Collateral",
      debt: "Debt",
      ltv: "Current LTV",
      liquidation: "Liquidation at",
      trigger: "Your rule fires at",
    },
  },

  simulator: {
    heading: "Run it against a market that already happened",
    body: "Same position, same reserve, same rule. Only the market changes. Two of these three outcomes are worse with the agent than without it.",
    exampleDataNote:
      "Example data. Price series are shaped from real drawdowns and are not tick data or a backtest.",
    scenarioLabel: "Market",
    positionHeading: "Position and rule",
    resultHeading: "Outcome at the last price",
    withAgent: "With the agent",
    withoutAgent: "With no agent",
    reserveLeft: "Reserve left",
    feesPaid: "Network fees",
    actionsTaken: "Actions taken",
    liquidated: "Liquidated",
    survived: "Not liquidated",
    liquidatedAt: "Liquidated at",
    difference: "Difference",
    chart: {
      price: "Price",
      ltvWithAgent: "LTV with the agent",
      ltvWithoutAgent: "LTV with no agent",
      // Short enough to sit in the right gutter without truncating. The
      // percentage renders under each one, so neither line needs the reader to
      // trace back to the axis.
      trigger: "Your rule",
      liquidation: "Liquidation",
      action: "Agent acted",
      axisTime: "Hours from the start of the fall",
      axisPrice: "SOL price",
      axisLtv: "LTV",
    },
    // Written from the numbers the simulator actually produces, not from
    // guesses about what it produces.
    takeaways: {
      recovery:
        "The rule worked. Without the agent the position was liquidated at $112.40 and the recovery arrived too late to matter.",
      wick:
        "The position was never in danger. Liquidation sat at $115.63 and the low was $128.10. The rule still spent $711.74, because it fires on a threshold and not on a forecast. It ended ahead here only because the reserve happened to buy SOL before SOL went back up, which is a coin flip on price direction and not something the agent knows.",
      "no-rebound":
        "This is the case that costs you money. Topping up converted the reserve into the asset that was falling. Liquidation was delayed from $113.60 to $77.40 and then happened anyway, with the reserve gone.",
    } as Record<string, string>,
  },

  capabilities: {
    heading: "What the agent can and cannot do",
    canHeading: "Can",
    can: [
      "Add collateral from your reserve",
      "Repay part of your debt from your reserve",
    ],
    canConstraints: [
      "Only once your LTV reaches the threshold you set",
      "No more often than your rate limit allows",
      "No more than the amount you cap",
    ],
    cannotHeading: "Cannot",
    cannot: [
      "Send funds to any other address",
      "Touch anything outside your reserve and your position",
      "Act after you revoke authorization",
      "Act after the authorization expires",
      "Act while your position is healthy",
    ],
    verifyHeading: "Check this yourself",
    verifyBody:
      "The list of instructions the program exposes is public. There is no instruction that transfers to an arbitrary address, which is why the agent cannot do it, rather than promising not to.",
    programLabel: "Program",
    notDeployedNote:
      "There is no explorer link yet because the program has not been deployed. Until it is, treat everything on this page as a description of intent.",
  },

  timeline: {
    heading: "What happens during a fall",
    note: "Example event. The timings are targets, not measured averages: the watcher is not running in production yet.",
    steps: [
      {
        label: "Price crosses your threshold",
        detail: "SOL reaches $129.20. Your LTV reaches 71.59%, past the 70.00% you set.",
        timing: "0s",
      },
      {
        label: "The watcher reads the new position",
        detail: "It holds a subscription to the obligation account, so it is not polling for this.",
        timing: "under 4s",
      },
      {
        label: "The agent submits the action",
        detail: "Add $799.74 of collateral from your reserve. Nothing else is in the transaction.",
        timing: "under 1s",
      },
      {
        label: "The transaction confirms",
        detail: "LTV goes from 71.59% to 62.00%. Liquidation moves from $115.63 to $100.13.",
        timing: "under 15s",
      },
      {
        label: "The report reaches your chat",
        detail: "What was done, how much, LTV before and after, a link to the transaction.",
        timing: "under 5s",
      },
    ],
  },

  limits: {
    heading: "When the agent does not help",
    body: "Every number below comes from the simulator above. You can reproduce all three.",
    cases: [
      {
        title: "The reserve runs out",
        body: "The rule can only spend what you put in. When the reserve is empty the agent stops acting and your position carries on falling without it.",
        figure: "$0",
        figureLabel: "reserve left after three actions in the third scenario",
      },
      {
        title: "A fall with no rebound",
        body: "Topping up converts your reserve into the asset that is falling. It delays liquidation and it can leave you with less than doing nothing at all.",
        figure: "-$2,014",
        figureLabel: "worse off with the agent in the third scenario",
      },
      {
        title: "A spike that reverses",
        body: "The rule fires on a threshold, not on a forecast. A move that reverses within the hour still spends the reserve and still pays the fees.",
        figure: "$711.74",
        figureLabel: "spent in the second scenario on a position that was never at risk",
      },
    ],
  },

  pricing: {
    heading: "Price",
    figure: "Free",
    figureLabel: "during the private beta",
    body: "Pricing after the beta is not decided. It will be published on this page before anything changes.",
    rows: [
      {
        label: "Network fees",
        value: "about $0.0025 per action",
        detail:
          "You pay Solana fees for every action the agent takes, at recent priority fee levels. A rule that fires three times during a fall costs under a cent.",
      },
      {
        label: "Reserve",
        value: "yours, withdrawable at any time",
        detail:
          "The reserve stays your money. Withdrawing it is not blocked by a paused agent, an expired authorization or a revoked one.",
      },
    ],
  },

  start: {
    heading: "Getting started",
    steps: [
      {
        title: "Connect a read only address",
        body: "Paste your address into the bot, or sign a message to prove you own it. No transaction, no keys, nothing to approve.",
        requires: "Nothing",
      },
      {
        title: "Set your rule in the chat",
        body: "The bot asks what you want done at each threshold while the market is calm. You answer in your own words and it reads back what it understood.",
        requires: "Nothing",
      },
      {
        title: "Grant authorization and fund the reserve",
        body: "Two signatures in the web app. This is the only step that needs your wallet, and it is the only thing the chat cannot do.",
        requires: "A wallet",
      },
    ],
  },

  footer: {
    docs: "Documentation",
    exit: "How to take everything and leave",
    program: "Program",
    github: "Source",
    audit: "Audit",
    contact: "Contact",
    status: "Service status",
    notYet: "not published yet",
    disclaimer:
      "Brace executes a rule you set. It does not predict prices and it does not guarantee that your position survives. Read the limits above before you use it.",
  },

  docs: {
    title: "Documentation",
    intro:
      "A reference, not marketing. Sections that are not written yet are listed as such rather than left as dead links.",
    written: "Available",
    pending: "Not written yet",
    index: [
      {
        title: "How to take everything and leave",
        href: "/docs/exit",
        summary: "Revoke authorization, withdraw the reserve, unlink the bot.",
        ready: true,
      },
      { title: "Getting started", summary: "Connecting, first rule, authorization, reserve.", ready: false },
      { title: "How a rule works", summary: "Thresholds, targets, amount and rate limits, expiry.", ready: false },
      { title: "Security", summary: "Full instruction list, key handling, compromise scenarios.", ready: false },
      { title: "Limits", summary: "The market conditions where the agent is useless or harmful.", ready: false },
      { title: "Failures and what to do", summary: "Empty reserve, failed action, stalled watcher, expired authorization.", ready: false },
      { title: "Reference", summary: "Rule fields, error codes, program addresses, supported markets.", ready: false },
      { title: "FAQ", summary: "Filled from real questions once there are some.", ready: false },
    ],
  },
} as const;
