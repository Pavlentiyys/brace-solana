/**
 * What the bot says, as a pure function of what it was asked and what is true.
 *
 * No model, no randomness, no hidden state: the same question against the same
 * position returns the same answer, which is the only way a chat surface can be
 * trusted to report somebody's risk. Everything the reply depends on arrives in
 * `ChatContext`, so the whole conversation is testable without React or a cluster.
 *
 * Tone follows the same rules as the rest of the product: the panel reports and the
 * user concludes. Nothing here says a position is safe.
 */

import { COMMANDS, commandByName, matchCommand, type CommandName } from "@/lib/chat/commands";
import type { ProposedAction } from "@/lib/chat/actions";
import type { Failure, PlatformMode } from "@/lib/platform/types";

/** A rendered piece of a message. Blocks map onto the existing screens. */
export type ChatBlock =
  | { kind: "text"; text: string }
  | { kind: "positions" }
  | { kind: "openPosition" }
  | { kind: "status" }
  | { kind: "reserve" }
  | { kind: "authorize" }
  | { kind: "history" }
  | { kind: "connect" }
  | { kind: "failure"; failure: Failure }
  /**
   * Something the agent proposed. Rendered as a card the user has to confirm and
   * sign; the model cannot execute anything on its own.
   */
  | { kind: "proposal"; action: ProposedAction };

export interface ChatMessage {
  id: string;
  role: "user" | "bot";
  at: number;
  blocks: ChatBlock[];
  /** Offered as chips under the message. */
  suggestions: CommandName[];
}

export interface ChatContext {
  connected: boolean;
  world: PlatformMode;
  walletKind: "demo" | "injected";
  clusterLabel: string;
  /** Null while the first read is still in flight. */
  positionCount: number | null;
  supportedCount: number;
  hasGuard: boolean;
  paused: boolean;
  /** Of the position being discussed, when there is one. */
  ltvBps: number | null;
  triggerBps: number | null;
  liquidationBps: number | null;
  refreshed: boolean;
  /** Set when the last read failed. */
  failure: Failure | null;
  /** False until the program is deployed, which gates every write. */
  canAct: boolean;
}

export interface BotReply {
  blocks: ChatBlock[];
  suggestions: CommandName[];
}

function text(...lines: string[]): ChatBlock[] {
  return lines.map((line) => ({ kind: "text", text: line }) as ChatBlock);
}

/** The opening message, which differs by what is already known. */
export function greeting(context: ChatContext): BotReply {
  if (!context.connected) {
    return {
      blocks: [
        ...text(
          "I watch a Kamino borrow and act on it under a rule you set. Connect a wallet and I will read your positions off the cluster.",
        ),
        { kind: "connect" },
      ],
      suggestions: ["help"],
    };
  }

  if (context.world === "demo") {
    return {
      blocks: text(
        "You are on the demo wallet, so everything below is a world running in this tab rather than a cluster. It behaves like the real thing, including the failures.",
        "Ask me how the position is doing, or what I can do.",
      ),
      suggestions: ["status", "positions", "help"],
    };
  }

  if (context.positionCount === null) {
    return { blocks: text("Reading your positions off the cluster."), suggestions: [] };
  }

  if (context.positionCount === 0) {
    return {
      blocks: text(
        `I looked through every Kamino market on ${context.clusterLabel} and this address holds no positions.`,
        "Borrow something on Kamino and I will pick it up on the next read. Nothing needs to be registered with me.",
      ),
      suggestions: ["wallet", "help"],
    };
  }

  const plural = context.positionCount === 1 ? "position" : "positions";
  return {
    blocks: [
      ...text(
        `Found ${context.positionCount} Kamino ${plural} on ${context.clusterLabel} for this address.`,
      ),
      { kind: "positions" },
    ],
    suggestions: context.supportedCount > 0 ? ["status", "authorize", "help"] : ["help", "wallet"],
  };
}

/** The reply to one thing the user said. */
export function reply(input: string, context: ChatContext): BotReply {
  const command = matchCommand(input);

  if (command === null) {
    return {
      blocks: text(
        "I did not understand that. I would rather say so than guess at something that moves money.",
        "Here is everything I do understand:",
        ...COMMANDS.map((entry) => `${entry.label} — ${entry.summary}`),
      ),
      suggestions: available(context).slice(0, 4),
    };
  }

  if (command.needsWallet && !context.connected) {
    return {
      blocks: [
        ...text("That one needs a wallet connected first."),
        { kind: "connect" },
      ],
      suggestions: ["help"],
    };
  }

  if (command.needsGuard && !context.hasGuard) {
    return {
      blocks: text(
        "There is no authorization on this position yet, so there is nothing to change.",
        "Setting one up is the step that needs your signature.",
      ),
      suggestions: ["authorize", "status"],
    };
  }

  switch (command.name) {
    case "help":
      return {
        blocks: text(
          "I read your Kamino position and, once you authorize me, repay part of the debt when your LTV reaches the threshold you set.",
          ...COMMANDS.map((entry) => `${entry.label} — ${entry.summary}`),
          "You can type any of that in your own words. I match on meaning, and I say so when I cannot.",
        ),
        suggestions: available(context).slice(0, 4),
      };

    case "wallet":
      return { blocks: [{ kind: "connect" }], suggestions: ["positions", "status"] };

    case "borrow":
      return {
        blocks: [
          ...text(
            "The Kamino markets already on devnet cannot be borrowed from — their collateral is a test token somebody else controls. This one was made for the project, so it can hand you the collateral.",
          ),
          { kind: "openPosition" },
        ],
        suggestions: ["status", "positions"],
      };

    case "positions":
      return {
        blocks: [{ kind: "positions" }],
        suggestions: context.supportedCount > 0 ? ["status", "authorize"] : ["help"],
      };

    case "status":
      return {
        blocks: [...statusPreamble(context), { kind: "status" }],
        suggestions: context.hasGuard
          ? [context.paused ? "resume" : "pause", "reserve", "history"]
          : ["authorize", "reserve"],
      };

    case "reserve":
      return { blocks: [{ kind: "reserve" }], suggestions: ["status", "history"] };

    case "authorize":
      return {
        blocks: [...cannotActYet(context), { kind: "authorize" }],
        suggestions: ["status", "reserve"],
      };

    case "history":
      return { blocks: [{ kind: "history" }], suggestions: ["status", "reserve"] };

    case "pause":
    case "resume":
    case "revoke":
      return {
        blocks: [
          ...cannotActYet(context),
          ...text(`${commandByName(command.name).label} is on the position panel, one action away.`),
          { kind: "status" },
        ],
        suggestions: ["status", "reserve"],
      };
  }
}

/**
 * What has to be said before a reading is shown.
 *
 * Staleness comes first because it changes what the number means. KLend only
 * recomputes an obligation's values inside `refresh_obligation`, so a position read
 * between transactions can be reporting an older price, and an LTV nobody flagged is
 * an LTV somebody will act on.
 */
function statusPreamble(context: ChatContext): ChatBlock[] {
  const lines: string[] = [];

  if (context.failure !== null) {
    return [{ kind: "failure", failure: context.failure }];
  }

  if (context.positionCount === 0) {
    return text("This address holds no Kamino positions, so there is nothing to report on.");
  }

  if (!context.refreshed) {
    lines.push(
      "Kamino has not refreshed this position since its last transaction, so the values below are the ones it last computed rather than the ones a price update would give now. Treat them as approximate.",
    );
  }

  if (context.ltvBps !== null && context.liquidationBps !== null && context.liquidationBps > 0) {
    const gap = context.liquidationBps - context.ltvBps;
    lines.push(
      gap > 0
        ? `LTV is ${bps(context.ltvBps)} against a liquidation threshold of ${bps(context.liquidationBps)}, so there is ${bps(gap)} of room.`
        : `LTV is ${bps(context.ltvBps)} and the liquidation threshold is ${bps(context.liquidationBps)}. This position is at or past the point where it can be liquidated.`,
    );
  }

  if (context.hasGuard && context.triggerBps !== null) {
    lines.push(
      context.paused
        ? `Your rule fires at ${bps(context.triggerBps)}, but the agent is paused and will not act.`
        : `Your rule fires at ${bps(context.triggerBps)}.`,
    );
  } else if (context.world === "chain") {
    lines.push("There is no authorization on this position, so nothing is watching it.");
  }

  return text(...lines);
}

/** Said once, before any screen that ends in a signature. */
function cannotActYet(context: ChatContext): ChatBlock[] {
  if (context.canAct) return [];
  return text(
    "The program is not deployed yet, so I cannot actually sign this. The screen below shows exactly what it will ask for when it is.",
  );
}

function bps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

/** The commands worth offering in this state. */
export function available(context: ChatContext): CommandName[] {
  return COMMANDS.filter((command) => {
    if (command.needsWallet && !context.connected) return false;
    if (command.needsGuard && !context.hasGuard) return false;
    if (command.name === "pause" && context.paused) return false;
    if (command.name === "resume" && !context.paused) return false;
    return true;
  }).map((command) => command.name);
}
