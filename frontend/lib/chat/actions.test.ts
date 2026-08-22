import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_SCHEMA,
  checkRule,
  describeAction,
  parseAction,
  toPolicy,
  type SetRuleAction,
} from "./actions";
import { MIN_COOLDOWN_SECONDS } from "@/lib/core/program";

/**
 * The boundary where a model's output becomes something a person signs.
 *
 * Everything here is about refusing rather than repairing. A malformed call must
 * produce nothing, not a plausible rule nobody asked for, because the next thing
 * that happens is a wallet prompt.
 */

const NOW = 1_800_000_000;
const rule = (overrides: Partial<SetRuleAction> = {}): SetRuleAction => ({
  kind: "set_rule",
  triggerPercent: 50,
  targetPercent: 42,
  ...overrides,
});

test("a plain rule parses into the numbers the user said", () => {
  const action = parseAction("set_rule", { triggerPercent: 50, targetPercent: 42 });
  assert.deepEqual(action, {
    kind: "set_rule",
    triggerPercent: 50,
    targetPercent: 42,
    maxActionTokens: undefined,
    cooldownSeconds: undefined,
    maxActionsPerWindow: undefined,
    windowHours: undefined,
    days: undefined,
  });
});

test("percent becomes basis points without a stray factor of ten", () => {
  // The failure this guards against: 50 arriving as 50 bps, a rule that never fires.
  const policy = toPolicy(rule(), NOW);
  assert.equal(policy.triggerLtvBps, 5_000);
  assert.equal(policy.targetLtvBps, 4_200);
});

test("an unknown tool name is dropped", () => {
  assert.equal(parseAction("liquidate_everything", { amount: 1 }), null);
  assert.equal(parseAction(null, {}), null);
  assert.equal(parseAction(42, {}), null);
});

test("a rule missing its numbers is refused, not filled in", () => {
  assert.equal(parseAction("set_rule", {}), null);
  assert.equal(parseAction("set_rule", { triggerPercent: 50 }), null);
  assert.equal(parseAction("set_rule", { triggerPercent: "fifty", targetPercent: 42 }), null);
  assert.equal(parseAction("set_rule", { triggerPercent: 0, targetPercent: 42 }), null);
  assert.equal(parseAction("set_rule", { triggerPercent: NaN, targetPercent: 42 }), null);
});

test("a deposit with no amount is refused; a withdrawal without one means everything", () => {
  assert.equal(parseAction("deposit", {}), null);
  assert.deepEqual(parseAction("withdraw", {}), { kind: "withdraw", tokens: null });
  assert.deepEqual(parseAction("withdraw", { tokens: 25 }), { kind: "withdraw", tokens: 25 });
});

test("the argumentless actions carry nothing a model could get wrong", () => {
  for (const kind of ["pause", "resume", "revoke"] as const) {
    assert.deepEqual(parseAction(kind, { amount: 999, destination: "somewhere" }), { kind });
  }
});

test("unspecified limits come from the defaults, not from the model", () => {
  const policy = toPolicy(rule(), NOW);
  const base = toPolicy(rule({ maxActionTokens: 5 }), NOW);
  assert.notEqual(policy.maxActionAmount, base.maxActionAmount);
  assert.equal(base.maxActionAmount, 5_000_000n);
});

test("limits the program would reject are clamped before a wallet opens", () => {
  // The program requires at least a thirty second cooldown and at most ninety days.
  assert.equal(toPolicy(rule({ cooldownSeconds: 1 }), NOW).cooldownSeconds, MIN_COOLDOWN_SECONDS);
  assert.equal(
    toPolicy(rule({ days: 4_000 }), NOW).expiresAt,
    NOW + 90 * 24 * 3_600,
  );
});

test("a target at or above the trigger is reported rather than signed", () => {
  const { problems } = checkRule(rule({ targetPercent: 55 }), { now: NOW });
  assert.ok(problems.length > 0);
  assert.ok(problems.some((problem) => problem.field === "targetLtvBps"));
});

test("a trigger at or above the liquidation threshold is reported", () => {
  // 90% trigger against an 85% liquidation threshold: the agent would only ever act
  // after the position was already liquidatable.
  const { problems } = checkRule(rule({ triggerPercent: 90, targetPercent: 80 }), {
    now: NOW,
    liquidationLtvBps: 8_500,
  });
  assert.ok(problems.length > 0);
});

test("a rule the program accepts reports no problems", () => {
  const { problems, policy } = checkRule(rule(), { now: NOW, liquidationLtvBps: 8_500 });
  assert.deepEqual(problems, []);
  assert.equal(policy.triggerLtvBps, 5_000);
});

test("every action describes itself before anything is signed", () => {
  assert.match(describeAction(rule(), "USDC"), /50%.*42%/);
  assert.match(describeAction({ kind: "withdraw", tokens: null }, "USDC"), /whole reserve/);
  assert.match(describeAction({ kind: "deposit", tokens: 25 }, "USDC"), /25 USDC/);
  assert.match(describeAction({ kind: "revoke" }, "USDC"), /withdrawing keeps working/);
});

test("the schema the model sees matches what the parser accepts", () => {
  // A tool the model can call but the parser drops is a silent dead end.
  for (const entry of ACTION_SCHEMA) {
    const required = "required" in entry.parameters ? [...entry.parameters.required] : [];
    const args = Object.fromEntries(required.map((name) => [name, 1]));
    assert.notEqual(parseAction(entry.name, args), null, `${entry.name} did not parse`);
  }
});

test("no tool can name a destination", () => {
  // The structural guarantee: there is no field through which a model could send
  // funds anywhere, because the program has no instruction that would accept one.
  const SUSPICIOUS = new Set(["address", "destination", "recipient", "to", "wallet", "account", "mint"]);
  const fields = ACTION_SCHEMA.flatMap((entry) => Object.keys(entry.parameters.properties));

  for (const field of fields) {
    // Split camelCase into words rather than matching substrings: "to" appears
    // inside "maxActionTokens" and a substring check would flag it.
    const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(" ");
    for (const word of words) {
      assert.ok(!SUSPICIOUS.has(word), `suspicious field ${field}`);
    }
  }

  // And every argument the model can supply is a number, so none of them can carry
  // an address even if one were named innocuously.
  for (const entry of ACTION_SCHEMA) {
    for (const [name, schema] of Object.entries(entry.parameters.properties)) {
      assert.equal((schema as { type: string }).type, "number", `${entry.name}.${name}`);
    }
  }
});
