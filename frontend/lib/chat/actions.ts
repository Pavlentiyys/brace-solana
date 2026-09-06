/**
 * What the agent is allowed to propose, and how a proposal becomes a policy.
 *
 * The model turns a sentence into one of these. It does not execute anything: an
 * action returned from the route is rendered as a proposal, checked against the same
 * rules the program enforces, and only signed if the user presses confirm and then
 * approves in their wallet.
 *
 * That is not a courtesy. The whole product rests on the agent being unable to move
 * money outside the limits its owner set, and a language model that could sign would
 * be a hole straight through that. So the schema below is a closed set of typed
 * numeric arguments — there is no field for a destination, no free-form instruction,
 * and nothing that reaches a wallet without passing `validatePolicy` first.
 *
 * The file is framework free so both the route and the browser use one definition:
 * the tool declaration the model sees is generated from `ACTION_SCHEMA`, and the
 * reply is parsed back through `parseAction`.
 */

import { ALLOWED_ACTIONS_V1, MIN_COOLDOWN_SECONDS, MAX_DELEGATION_SECONDS } from "@/lib/core/program";
import { defaultPolicy, validatePolicy, type Policy, type PolicyProblem } from "@/lib/core/policy";
import { QUOTE_DECIMALS } from "@/lib/core/units";

export type ActionKind =
  | "set_rule"
  | "repay_now"
  | "pause"
  | "resume"
  | "revoke"
  | "deposit"
  | "withdraw";

export interface SetRuleAction {
  kind: "set_rule";
  /** The LTV the agent starts acting at, in whole percent as a person says it. */
  triggerPercent: number;
  /** The LTV an action restores. Strictly below the trigger. */
  targetPercent: number;
  /** Per-action cap in whole tokens of the reserve mint. */
  maxActionTokens?: number;
  cooldownSeconds?: number;
  maxActionsPerWindow?: number;
  windowHours?: number;
  /** How long the authorization lasts. The program caps it at ninety days. */
  days?: number;
}

/** A request to open the owner-signed one-off repayment flow. */
export interface RepayNowAction {
  kind: "repay_now";
}

export type ProposedAction =
  | SetRuleAction
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "revoke" }
  | { kind: "deposit"; tokens: number }
  /** `null` means the whole reserve. */
  | { kind: "withdraw"; tokens: number | null };

export type ParsedAction = ProposedAction | RepayNowAction;

/**
 * The declaration the model is given, in the shape Gemini's function calling wants.
 *
 * Percentages rather than basis points on purpose: a model asked for "50%" writes 50
 * far more reliably than 5000, and one misplaced zero here is a rule that fires at
 * 5% or never fires at all.
 */
export const ACTION_SCHEMA = [
  {
    name: "set_rule",
    description:
      "Set or change the automation rule on the user's position. Use this whenever they describe when the agent should act, for example 'start repaying at 50% LTV'. Never invent limits they did not ask for; leave optional fields out and sensible defaults are used.",
    parameters: {
      type: "object",
      properties: {
        triggerPercent: {
          type: "number",
          description: "LTV, in percent, at or above which the agent repays. For example 50 for 50%.",
        },
        targetPercent: {
          type: "number",
          description:
            "LTV, in percent, an action brings the position back to. Must be below triggerPercent. If the user does not say, use about 8 points below the trigger.",
        },
        maxActionTokens: {
          type: "number",
          description: "Optional cap on how much the agent may repay in one action, in whole tokens.",
        },
        cooldownSeconds: {
          type: "number",
          description: "Optional minimum seconds between actions. At least 30.",
        },
        maxActionsPerWindow: { type: "number", description: "Optional cap on actions per window." },
        windowHours: { type: "number", description: "Optional length of the rate limit window, in hours." },
        days: { type: "number", description: "Optional days the authorization lasts. At most 90." },
      },
      required: ["triggerPercent", "targetPercent"],
    },
  },
  {
    name: "repay_now",
    description:
      "Open the one-time owner repayment flow when the user asks to repay now, repay at the current LTV, or make an immediate repayment. This is not a rule change: do not call set_rule for an immediate repayment.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "pause",
    description: "Stop the agent acting, keeping the authorization in place.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "resume",
    description: "Let a paused agent act again.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "revoke",
    description:
      "End the authorization entirely. The reserve stays the user's and withdrawing keeps working.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "deposit",
    description: "Move tokens from the user's wallet into the agent's reserve.",
    parameters: {
      type: "object",
      properties: { tokens: { type: "number", description: "Whole tokens to deposit." } },
      required: ["tokens"],
    },
  },
  {
    name: "withdraw",
    description:
      "Take tokens back out of the reserve. Omit the amount to withdraw all of it.",
    parameters: {
      type: "object",
      properties: { tokens: { type: "number", description: "Whole tokens, or omit for the whole reserve." } },
    },
  },
] as const;

const KINDS = new Set<string>(ACTION_SCHEMA.map((entry) => entry.name));

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Parses what the model returned, or returns null.
 *
 * Deliberately strict. A malformed call is dropped rather than repaired, because a
 * "repaired" rule is one nobody asked for, and the user would be signing it.
 */
export function parseAction(name: unknown, args: unknown): ParsedAction | null {
  if (typeof name !== "string" || !KINDS.has(name)) return null;
  const input = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;

  switch (name) {
    case "repay_now":
      return { kind: "repay_now" };
    case "pause":
    case "resume":
    case "revoke":
      return { kind: name };

    case "deposit": {
      const tokens = positive(input.tokens);
      return tokens === undefined ? null : { kind: "deposit", tokens };
    }

    case "withdraw": {
      const tokens = positive(input.tokens);
      return { kind: "withdraw", tokens: tokens ?? null };
    }

    case "set_rule": {
      const triggerPercent = positive(input.triggerPercent);
      const targetPercent = positive(input.targetPercent);
      if (triggerPercent === undefined || targetPercent === undefined) return null;

      return {
        kind: "set_rule",
        triggerPercent,
        targetPercent,
        maxActionTokens: positive(input.maxActionTokens),
        cooldownSeconds: positive(input.cooldownSeconds),
        maxActionsPerWindow: positive(input.maxActionsPerWindow),
        windowHours: positive(input.windowHours),
        days: positive(input.days),
      };
    }

    default:
      return null;
  }
}

function bps(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * A proposal into the policy the program will actually be given.
 *
 * Anything the user did not specify comes from `defaultPolicy`, so a rule stays the
 * one they described rather than one the model filled in around the edges. Clamping
 * happens here too — the program rejects a cooldown under thirty seconds or a
 * delegation over ninety days, and being told that by a wallet prompt is worse than
 * being told it by the screen.
 */
export function toPolicy(action: SetRuleAction, now: number): Policy {
  const base = defaultPolicy(now);
  const days = action.days === undefined ? undefined : Math.min(action.days, 90);

  return {
    ...base,
    triggerLtvBps: bps(action.triggerPercent),
    targetLtvBps: bps(action.targetPercent),
    maxActionAmount:
      action.maxActionTokens === undefined
        ? base.maxActionAmount
        : BigInt(Math.round(action.maxActionTokens * 10 ** QUOTE_DECIMALS)),
    cooldownSeconds:
      action.cooldownSeconds === undefined
        ? base.cooldownSeconds
        : Math.max(action.cooldownSeconds, MIN_COOLDOWN_SECONDS),
    maxActionsPerWindow: action.maxActionsPerWindow ?? base.maxActionsPerWindow,
    windowSeconds:
      action.windowHours === undefined ? base.windowSeconds : Math.round(action.windowHours * 3_600),
    allowedActions: ALLOWED_ACTIONS_V1,
    expiresAt:
      days === undefined
        ? base.expiresAt
        : Math.min(now + days * 24 * 3_600, now + MAX_DELEGATION_SECONDS),
  };
}

export interface CheckedRule {
  policy: Policy;
  problems: PolicyProblem[];
}

/** The proposal, checked against the same rules `PolicyParams::validate` enforces. */
export function checkRule(
  action: SetRuleAction,
  context: { now: number; liquidationLtvBps?: number },
): CheckedRule {
  const policy = toPolicy(action, context.now);
  return { policy, problems: validatePolicy(policy, context) };
}

/** One line describing what pressing confirm will do. Shown before any wallet opens. */
export function describeAction(action: ParsedAction, symbol: string): string {
  switch (action.kind) {
    case "repay_now":
      return "Open the one-time repayment flow using the current position and reserve values.";
    case "set_rule":
      return `Repay from the reserve whenever LTV reaches ${action.triggerPercent}%, bringing it back to ${action.targetPercent}%.`;
    case "pause":
      return "Stop the agent acting. The authorization stays in place.";
    case "resume":
      return "Let the agent act again.";
    case "revoke":
      return "End the authorization. Your reserve stays yours and withdrawing keeps working.";
    case "deposit":
      return `Move ${action.tokens} ${symbol} from your wallet into the reserve.`;
    case "withdraw":
      return action.tokens === null
        ? "Take the whole reserve back into your wallet."
        : `Take ${action.tokens} ${symbol} back into your wallet.`;
  }
}
