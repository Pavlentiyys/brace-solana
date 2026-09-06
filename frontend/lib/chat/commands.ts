/**
 * What the bot can be asked to do.
 *
 * A closed set, deliberately. PLATFORM.md 3 puts conversation at the centre of the
 * product, and the temptation with a chat surface is to let it accept anything and
 * guess. This one refuses to guess: it either recognises the intent or says which
 * words it does recognise. A rule engine that quietly misreads "revoke" as "reserve"
 * is worse than a menu.
 *
 * Free text is matched by keyword rather than parsed, so "how close am I to
 * liquidation" reaches `status` without anybody having to learn a slash command.
 */

export type CommandName =
  | "help"
  | "borrow"
  | "positions"
  | "status"
  | "reserve"
  | "authorize"
  | "repay"
  | "schedule"
  | "history"
  | "pause"
  | "resume"
  | "revoke"
  | "wallet";

export interface CommandSpec {
  name: CommandName;
  /** Text on the suggestion chip, and the one name this action goes by. */
  label: string;
  summary: string;
  /** Lowercase words that route free text here. */
  keywords: string[];
  needsWallet: boolean;
  /** Needs an authorization to exist before it means anything. */
  needsGuard: boolean;
}

export const COMMANDS: CommandSpec[] = [
  {
    name: "help",
    label: "What can you do",
    summary: "List everything I understand.",
    // Deliberately narrow. Filler words like "what", "how" and "can" open almost
    // every real question, so listing them here made `help` swallow "what is my
    // ltv" — the one routing mistake that leaves somebody without an answer about
    // their own risk.
    keywords: ["help", "commands", "command", "usage", "options", "explain"],
    needsWallet: false,
    needsGuard: false,
  },
  {
    name: "wallet",
    label: "Wallet",
    summary: "Which address is connected, and on which cluster.",
    keywords: ["wallet", "address", "connect", "disconnect", "phantom", "cluster", "network"],
    needsWallet: false,
    needsGuard: false,
  },
  {
    name: "borrow",
    label: "Open a test borrow",
    summary: "Open a real Kamino position on devnet, so there is something to watch.",
    // Narrow on purpose. "position", "debt" and "loan" belong to questions about an
    // existing borrow, and letting them route here sent "how is my position" to an
    // action that opens a new loan — the worst routing mistake this surface can make.
    keywords: ["borrow", "open", "create", "test", "faucet"],
    needsWallet: true,
    needsGuard: false,
  },
  {
    name: "positions",
    label: "My borrows",
    summary: "Every borrow this address holds on Kamino.",
    keywords: ["positions", "borrows", "loans", "obligations", "kamino", "list", "mine"],
    needsWallet: true,
    needsGuard: false,
  },
  {
    name: "status",
    label: "How is my position",
    summary: "LTV, distance to liquidation, and whether the agent is watching.",
    keywords: [
      "status", "ltv", "health", "risk", "liquidation", "liquidated", "close",
      "position", "safe", "danger", "price", "now", "debt", "owe",
    ],
    needsWallet: true,
    needsGuard: false,
  },
  {
    name: "reserve",
    label: "Reserve",
    summary: "What is in the reserve and how far it goes.",
    keywords: ["reserve", "fund", "deposit", "withdraw", "balance", "top", "up", "money"],
    needsWallet: true,
    needsGuard: false,
  },
  {
    name: "authorize",
    label: "Set up a rule",
    summary: "Authorize the agent, with the limits it will be held to.",
    keywords: ["authorize", "authorise", "rule", "setup", "set", "start", "delegate", "policy", "trigger"],
    needsWallet: true,
    needsGuard: false,
  },
  {
    name: "repay",
    label: "Repay now",
    summary: "Send part of your reserve, or all of it, at the debt right now.",
    // "now" is deliberately absent: it belongs to "how is my position now", which is
    // the question this surface must never misroute.
    keywords: ["repay", "pay", "payoff", "settle", "clear", "reduce"],
    needsWallet: true,
    needsGuard: true,
  },
  {
    name: "schedule",
    label: "Repay on a schedule",
    summary: "Repay a fixed amount every week, or on whatever interval you set.",
    keywords: ["schedule", "scheduled", "recurring", "weekly", "monthly", "daily", "regularly", "every", "automatic"],
    needsWallet: true,
    needsGuard: true,
  },
  {
    name: "history",
    label: "History",
    summary: "Every action the agent has taken.",
    keywords: ["history", "receipts", "actions", "log", "past", "did", "happened"],
    needsWallet: true,
    needsGuard: false,
  },
  {
    name: "pause",
    label: "Pause the agent",
    summary: "Stop the agent acting, without giving up the authorization.",
    keywords: ["pause", "stop", "halt", "freeze", "suspend"],
    needsWallet: true,
    needsGuard: true,
  },
  {
    name: "resume",
    label: "Resume the agent",
    summary: "Let the agent act again.",
    keywords: ["resume", "unpause", "continue", "restart", "enable"],
    needsWallet: true,
    needsGuard: true,
  },
  {
    name: "revoke",
    label: "Revoke authorization",
    summary: "End the authorization. Your reserve stays yours and withdrawing still works.",
    keywords: ["revoke", "cancel", "end", "terminate", "kill", "remove"],
    needsWallet: true,
    needsGuard: true,
  },
];

const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));

export function commandByName(name: CommandName): CommandSpec {
  const command = BY_NAME.get(name);
  if (!command) throw new Error(`unknown command ${name}`);
  return command;
}

/**
 * Routes what the user typed to one command, or to nothing.
 *
 * A leading slash is exact and wins outright. Otherwise every word is scored against
 * the keyword lists and the best match has to clear a floor, so an unrelated sentence
 * comes back as `null` and gets an honest "I did not understand" rather than being
 * rounded to whichever command shared a preposition with it.
 */
export function matchCommand(input: string): CommandSpec | null {
  const text = input.trim().toLowerCase();
  if (text === "") return null;

  if (text.startsWith("/")) {
    const name = text.slice(1).split(/\s+/)[0];
    return COMMANDS.find((command) => command.name === name) ?? null;
  }

  // An immediate repayment is a one-off owner action, not a request to inspect
  // status or create a rule. Handle the common English and Russian phrasing before
  // keyword scoring, where `ltv`, `now` and `current` could otherwise make status
  // win over the repayment verb.
  if (
    /(?:\b(repay|payoff|settle|clear)\b|погаси(?:ть|у)?|погашение)[\s\S]*(?:\b(now|current|immediate)\b|сейчас|текущ(?:ий|ая|ем|ей))/i.test(text) ||
    /(?:\b(now)\b|сейчас)[\s\S]*(?:\b(repay|payoff|settle|clear)\b|погаси(?:ть|у)?|погашение)/i.test(text)
  ) {
    return commandByName("repay");
  }

  const words = text.split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0) return null;

  let best: { command: CommandSpec; score: number } | null = null;
  for (const command of COMMANDS) {
    // Distinct matches, so repeating a word does not outvote a better command.
    const hits = new Set(words.filter((word) => command.keywords.includes(word)));
    // Longer keyword lists are easier to hit by accident, so normalise by them.
    const score = hits.size === 0 ? 0 : hits.size + hits.size / command.keywords.length;
    if (score > 0 && (best === null || score > best.score)) best = { command, score };
  }

  return best !== null && best.score >= 1 ? best.command : null;
}
