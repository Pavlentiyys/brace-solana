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
    docs: "Docs",
    app: "App",
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
    cta: "Open the app",
    ctaNote:
      "The app is the third step. It runs against a demo world until the program is deployed, and it says so on every screen.",
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

  founders: {
    heading: "Founders",
    badge: "Core Team",
    lead: "Meet the core builders behind Brace autonomous liquidation defense.",
    githubLabel: "GitHub profile of",
    telegramLabel: "Telegram of",
    members: [
      {
        name: "Miroslav",
        handle: "@miroslawvwv",
        role: "CEO & Product Architect",
        avatar: "https://github.com/gEomX12.png",
        bio: "Driving Brace product vision, high-density Web3 UX, and Kamino ecosystem integrations.",
        stack: ["Product UX", "Next.js", "DeFi Strategy", "Solana"],
        github: "https://github.com/gEomX12",
        telegram: "https://t.me/miroslawvwv",
      },
      {
        name: "Pavel",
        handle: "@Mirceya",
        role: "CTO & Lead Protocol Engineer",
        avatar: "https://github.com/Pavlentiyys.png",
        bio: "Architecting low-latency Solana programs, autonomous keeper infrastructure, and MEV-safe liquidation defense.",
        stack: ["Rust / Anchor", "Solana Core", "Keeper Infra", "Risk Engine"],
        github: "https://github.com/Pavlentiyys",
        telegram: "https://t.me/Mirceya",
      },
    ],
  },

  footer: {
    app: "App",
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

  /**
   * The signed-in app (PLATFORM.md section 2). The bot owns conversation; these
   * screens own the four operations that need a wallet, plus the panel.
   *
   * Same tone rules as the landing. One extra rule applies here because these
   * screens are read while somebody is deciding whether to hand over authority:
   * nothing claims the position is safe. The panel reports; the user concludes.
   */
  app: {
    nav: {
      panel: "Position",
      reserve: "Reserve",
      history: "History",
      authorize: "Authorization",
    },
    demoBanner: {
      title: "This is a demo",
      notConfigured:
        "The program is not deployed, so this app runs against a world in your browser. The price moves, the rule fires, the reserve goes down. Nothing here touches a chain and no receipt has a transaction to link to.",
      programNotDeployed:
        "An RPC endpoint is configured, but the program id is still the placeholder in the source, so there is nothing to read. Until the program is deployed the app runs against a world in your browser.",
      reset: "Reset the demo",
    },
    connect: {
      heading: "Connect a wallet",
      body: "The web app exists for the four things that need a signature: authorization, funding the reserve, withdrawing it, and revoking. Everything else lives in the chat.",
      unavailable:
        "No Solana wallet is installed in this browser. Install one, then reload this page.",
      connecting: "Waiting for the wallet",
      disconnect: "Disconnect",
      readOnlyNote:
        "Connecting reads your public address. It does not authorize anything and does not move anything.",
    },
    discovery: {
      heading: "Your borrows",
      searching: "Looking for borrows in the supported markets",
      noneHeading: "No borrows found for this address",
      noneBody:
        "The agent works on an existing borrow, so there has to be one before there is anything to guard. Open a position in a supported market first, then come back.",
      noneLink: "Kamino",
      unsupportedLabel: "Not supported",
      unsupportedHeading: "Found, but the agent cannot act on it",
      supportedLabel: "Supported",
      guarded: "Authorized",
      notGuarded: "No authorization yet",
      open: "Open",
      authorize: "Grant authorization",
    },
    panel: {
      title: "Position",
      ltvLabel: "Current LTV",
      toTrigger: "to your rule",
      toLiquidation: "to liquidation",
      pastTrigger: "past your rule",
      pastLiquidation: "past liquidation",
      triggerAt: "Your rule fires at",
      liquidationAt: "Liquidation at",
      priceNow: "SOL price",
      liveness: {
        label: "Last check",
        fresh: "The watcher is reading your position.",
        lagging: "The watcher is behind. It has not reported for longer than a normal cycle.",
        stalled:
          "The watcher has not reported for over a minute. Treat this position as unwatched until it comes back.",
        unknown: "The watcher has not reported at all yet.",
      },
      agent: {
        label: "Agent",
        armed: "Would act now",
        watching: "Watching",
        wouldNotAct: "Would not act",
        blockers: {
          revoked: "Authorization revoked",
          expired: "Authorization expired",
          paused: "Paused by you",
          below_trigger: "LTV is below your trigger",
          rate_limited: "The action limit for this window is used up",
          cooling_down: "Cooling down after the last action",
          reserve_empty: "The reserve is empty",
        },
      },
      reserve: {
        label: "Reserve",
        firings: "firings left at the current rule",
        firingsOne: "firing left at the current rule",
        empty: "Empty. The agent cannot act until you fund it.",
        manage: "Fund or withdraw",
      },
      authority: {
        label: "Authorization",
        expiresOn: "Ends on",
        left: "left",
        expired: "This authorization has ended. The agent cannot act.",
        revoked: "You revoked this authorization. The agent cannot act.",
        paused: "You paused the agent. It will not act until you resume.",
        nearExpiry: "This authorization ends within a week. The agent stops acting when it does.",
        window: "Actions this window",
        windowResets: "resets",
        cooldown: "Cooldown",
        ready: "ready",
      },
      rule: {
        label: "Your rule",
        sentence:
          "When LTV reaches {trigger}, repay from the reserve until LTV is back to {target}, at most {cap} in one action and at most {count} times per {window}.",
        changeInChat: "Change this in the chat",
        changeNote: "Rules are set in conversation, not in a form. The web app only shows what is set.",
      },
      controls: {
        pause: "Pause the agent",
        resume: "Resume the agent",
        withdraw: "Withdraw the reserve",
        revoke: "Revoke authorization",
        revokeNote:
          "One click, no confirmation step. Withdrawing the reserve is not blocked by revoking, expiry or a pause.",
      },
      noGuardHeading: "No authorization for this position",
      noGuardBody:
        "The agent is reading this position and can do nothing to it. Granting authorization is the step that changes that, and it is reversible in one click.",
    },
    authorize: {
      title: "Authorization",
      heading: "What you are about to allow",
      lead: "This is the only thing the chat cannot do for you. Read the two lists before you sign; they are generated from the program, not written by hand.",
      canHeading: "The agent will be able to",
      cannotHeading: "The agent will not be able to",
      can: {
        repay: "Repay part of your debt from your reserve",
        top_up: "Add collateral from your reserve",
      },
      cannot: [
        "Send funds to any other address",
        "Touch anything except your reserve and this position",
        "Act while LTV is below your trigger",
        "Act more often than your limits allow",
        "Act after you revoke, or after the end date below",
        "Stop you withdrawing the reserve at any time",
      ],
      verifyHeading: "Check this rather than believe it",
      verifyBody:
        "The program exposes six instructions. None of them transfers to an address you did not set. That is why the agent cannot do it, rather than a promise not to.",
      instructionsLabel: "Instructions in the program",
      notDeployed:
        "The program is not deployed yet, so there is no explorer link and nothing to sign. This screen shows what authorization will ask for.",
      limitsHeading: "The limits you are setting",
      trigger: "Fires at",
      target: "Restores to",
      cap: "Most in one action",
      rate: "Most actions",
      cooldown: "Minimum gap between actions",
      expiry: "Ends on",
      expiryNote:
        "A date rather than a duration, because a date is something you can check against a calendar.",
      programCeiling: "The program refuses any authorization longer than ninety days.",
      submit: "Grant authorization",
      submitting: "Waiting for the wallet",
      done: "Authorization granted.",
      ruleFromChat: "These values come from the rule you set in the chat.",
      ruleFallback:
        "No rule has arrived from the chat, so these are starting values. Set your rule in the chat first if you want different ones.",
    },
    reserve: {
      title: "Reserve",
      heading: "The money the agent is allowed to spend",
      lead: "It stays yours. Withdrawing is not blocked by a paused agent, an expired authorization or a revoked one, and that is a property of the program rather than a policy of ours.",
      balance: "In the reserve",
      walletBalance: "In your wallet",
      depositHeading: "Add to the reserve",
      withdrawHeading: "Take it back",
      amount: "Amount",
      max: "Max",
      deposit: "Fund the reserve",
      withdraw: "Withdraw",
      withdrawAll: "Withdraw everything",
      sizingHeading: "How far this goes",
      oneAction: "One firing of your rule costs",
      oneActionNote:
        "Measured at your trigger, not at today's price, because that is where the agent acts.",
      coverageHeading: "What it takes to hold this position through a fall",
      coverageDrop: "Price falls",
      coverageLtv: "LTV reaches",
      coverageNeeded: "Repay needed",
      coverageStatus: "Your reserve",
      covered: "covers it",
      notCovered: "short by",
      noFire: "rule does not fire",
      beyondRule: "more than your rule can spend in one window, which is",
      passesLiquidation:
        "A fall this deep goes past the liquidation threshold. The agent acts on the way down, so whether it gets there first depends on how fast the price moves.",
      depth: "Your rule and your reserve hold this position through a fall of about",
      depthAll: "Nothing this model reaches breaks through your rule and your reserve.",
      depthNone: "Your reserve does not cover the first firing of your rule.",
      emptyNote: "The reserve is empty, so the agent cannot act however far the price falls.",
    },
    history: {
      title: "History",
      heading: "Every action and every attempt",
      lead: "Including the ones that failed. An attempt that did not land is the case that matters most, so it is in the list rather than in a log somewhere.",
      empty: "Nothing has happened to this guard yet.",
      viewTransaction: "Transaction",
      noTransaction: "no transaction, this is demo data",
      failedLabel: "Failed",
      failedLead: "The watcher tried and the transaction did not go through.",
      onChainError: "The chain reported",
    },
    failure: {
      heading: "Something did not work",
      retry: "Try again",
      wallet_unavailable: {
        title: "No wallet in this browser",
        body: "Install a Solana wallet and reload the page.",
      },
      wallet_rejected: {
        title: "You dismissed the wallet prompt",
        body: "Nothing was sent and nothing changed. Try again when you are ready.",
      },
      insufficient_funds: {
        title: "Not enough to cover that",
        body: "The amount is above the balance available for it.",
      },
      rpc_unavailable: {
        title: "Cannot reach the network",
        body: "The numbers below are the last ones that arrived and they are not being updated. Nothing has happened to your position because of this, but this app cannot see it right now.",
      },
      price_stale: {
        title: "The price behind these numbers is old",
        body: "Every reading on this screen is derived from it, so treat them as approximate until it updates.",
      },
      congested: {
        title: "The network did not accept the transaction",
        body: "Solana was busy enough to drop it. Sending it again with a higher priority fee usually works.",
      },
      authorization_expired: {
        title: "The authorization ended while you were on this page",
        body: "The agent has stopped acting. Your reserve is still yours and withdrawing it still works.",
      },
      program_not_deployed: {
        title: "The program is not deployed",
        body: "There is nothing to sign against yet. This screen shows what the operation will ask for.",
      },
      invalid_policy: {
        title: "The program would reject this rule",
        body: "It was checked here rather than on chain, so this cost you nothing.",
      },
      unknown: {
        title: "Unexpected failure",
        body: "This is the message the app got back.",
      },
    },
    demoControls: {
      heading: "Demo controls",
      body: "The failure paths are the ones a demo never shows. These switch them on so they can be read on the screen rather than taken on trust.",
      price: "Move the price",
      down10: "Down 10%",
      down25: "Down 25%",
      up10: "Up 10%",
      faults: "Faults",
      fault: {
        rpc_unavailable: "Network unreachable",
        watcher_stalled: "Watcher stopped",
        price_stale: "Price stops updating",
        action_fails: "Actions fail on chain",
        congested: "Network drops transactions",
        wallet_rejects: "Wallet rejects everything",
      },
      expiry: "Authorization",
      expireSoon: "Ends in 3 days",
      expireNow: "End it now",
    },
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
