import assert from "node:assert/strict";
import test from "node:test";

import { COMMANDS, matchCommand } from "./commands";
import { available, greeting, reply, type ChatBlock, type ChatContext } from "./engine";

/**
 * The bot is a pure function, so all of it is testable here.
 *
 * The cases that matter are the ones where a chat surface can do damage: routing a
 * question to the wrong action, or answering about risk without saying the numbers
 * are stale. Both are asserted rather than left to a reviewer clicking around.
 */

const CONNECTED: ChatContext = {
  connected: true,
  world: "chain",
  walletKind: "injected",
  clusterLabel: "Devnet",
  positionCount: 1,
  supportedCount: 1,
  hasGuard: false,
  paused: false,
  ltvBps: 6_090,
  triggerBps: null,
  liquidationBps: 6_500,
  refreshed: true,
  failure: null,
  canAct: false,
};

const DISCONNECTED: ChatContext = { ...CONNECTED, connected: false, positionCount: null };

function texts(blocks: ChatBlock[]): string {
  return blocks
    .filter((block): block is { kind: "text"; text: string } => block.kind === "text")
    .map((block) => block.text)
    .join(" ");
}

function kinds(blocks: ChatBlock[]): string[] {
  return blocks.map((block) => block.kind);
}

test("a slash command is exact", () => {
  assert.equal(matchCommand("/revoke")?.name, "revoke");
  assert.equal(matchCommand("/status")?.name, "status");
  assert.equal(matchCommand("/nonsense"), null);
});

test("plain questions reach the right command", () => {
  assert.equal(matchCommand("how close am I to liquidation")?.name, "status");
  assert.equal(matchCommand("what is my ltv")?.name, "status");
  assert.equal(matchCommand("show me my borrows")?.name, "positions");
  assert.equal(matchCommand("I want to stop the agent")?.name, "pause");
  assert.equal(matchCommand("cancel the authorization")?.name, "revoke");
  assert.equal(matchCommand("how much is in the reserve")?.name, "reserve");
});

test("an immediate repayment request beats the status words around current LTV", () => {
  assert.equal(matchCommand("repay now at current LTV")?.name, "repay");
  assert.equal(matchCommand("попросил сейчас погасить при текущем LTV")?.name, "repay");
});

test("an unrelated sentence is refused rather than rounded to a command", () => {
  // The failure mode being guarded against: sharing one preposition with a command
  // must not be enough to trigger something that moves money.
  assert.equal(matchCommand("the weather in Lisbon is nice"), null);
  assert.equal(matchCommand("asdfghjkl"), null);
  assert.equal(matchCommand(""), null);
});

test("a question about an existing position never opens a new loan", () => {
  // The collision that actually happened: `borrow` listed "position" and "debt" as
  // keywords, so "how is my position" routed to the action that takes out a loan.
  assert.equal(matchCommand("how is my position")?.name, "status");
  assert.equal(matchCommand("my debt")?.name, "status");
  assert.equal(matchCommand("how much debt do I have")?.name, "status");

  // While the ones that really are asking to open something still get there.
  assert.equal(matchCommand("open a test borrow")?.name, "borrow");
  assert.equal(matchCommand("I want to borrow")?.name, "borrow");
  assert.equal(matchCommand("create a test position")?.name, "borrow");
  assert.equal(matchCommand("show me my borrows")?.name, "positions");
});

test("revoke and reserve are not confused for each other", () => {
  // They share a prefix and a topic, and picking the wrong one is irreversible in
  // one direction.
  assert.equal(matchCommand("revoke")?.name, "revoke");
  assert.equal(matchCommand("reserve")?.name, "reserve");
});

test("an unknown question lists what is understood instead of guessing", () => {
  const answer = reply("the weather in Lisbon is nice", CONNECTED);
  assert.match(texts(answer.blocks), /did not understand/);
  for (const command of COMMANDS) {
    assert.ok(texts(answer.blocks).includes(command.label), `missing ${command.label}`);
  }
});

test("a command that needs a wallet asks for one instead of failing", () => {
  const answer = reply("what is my ltv", DISCONNECTED);
  assert.ok(kinds(answer.blocks).includes("connect"));
  assert.ok(!kinds(answer.blocks).includes("status"));
});

test("pausing without an authorization explains rather than pretends", () => {
  const answer = reply("/pause", { ...CONNECTED, hasGuard: false });
  assert.match(texts(answer.blocks), /no authorization/);
  assert.deepEqual(answer.suggestions, ["authorize", "status"]);
});

test("a status answer states the gap to liquidation in the same terms every time", () => {
  const answer = reply("/status", CONNECTED);
  const said = texts(answer.blocks);
  assert.match(said, /60\.90%/);
  assert.match(said, /65\.00%/);
  assert.match(said, /4\.10% of room/);
  assert.ok(kinds(answer.blocks).includes("status"), "the panel itself is rendered");
});

test("a position at or past its threshold is not described as having room", () => {
  const answer = reply("/status", { ...CONNECTED, ltvBps: 6_600, liquidationBps: 6_500 });
  const said = texts(answer.blocks);
  assert.match(said, /at or past the point/);
  assert.doesNotMatch(said, /room/);
});

test("stale values are flagged before the number is given", () => {
  const answer = reply("/status", { ...CONNECTED, refreshed: false });
  const said = texts(answer.blocks);
  assert.match(said, /has not refreshed/);
  // The warning has to come first: a reader who stops after one line must have got
  // the caveat, not the figure.
  assert.ok(said.indexOf("has not refreshed") < said.indexOf("LTV is"));
});

test("a failed read reports the failure instead of a reassuring blank", () => {
  const failure = { kind: "rpc_unavailable", detail: "timeout" } as const;
  const answer = reply("/status", { ...CONNECTED, failure });
  assert.deepEqual(kinds(answer.blocks), ["failure", "status"]);
});

test("nothing claims a position is safe", () => {
  for (const context of [CONNECTED, { ...CONNECTED, ltvBps: 100 }]) {
    const said = texts(reply("/status", context).blocks).toLowerCase();
    for (const banned of ["safe", "don't worry", "no risk", "protected"]) {
      assert.ok(!said.includes(banned), `status said "${banned}"`);
    }
  }
});

test("screens that end in a signature say the program is not deployed first", () => {
  const answer = reply("/authorize", CONNECTED);
  assert.match(texts(answer.blocks), /not deployed/);
  assert.equal(kinds(answer.blocks).at(-1), "authorize");

  // And stop saying it once there is something to sign against.
  const deployed = reply("/authorize", { ...CONNECTED, canAct: true });
  assert.deepEqual(kinds(deployed.blocks), ["authorize"]);
});

test("the greeting reports the real count once the read lands", () => {
  assert.match(texts(greeting({ ...CONNECTED, positionCount: null }).blocks), /Reading your positions/);
  assert.match(
    texts(greeting({ ...CONNECTED, positionCount: 0, supportedCount: 0 }).blocks),
    /holds no positions/,
  );
  assert.match(texts(greeting(CONNECTED).blocks), /Found 1 Kamino position on Devnet/);
  assert.match(
    texts(greeting({ ...CONNECTED, positionCount: 3, supportedCount: 3 }).blocks),
    /Found 3 Kamino positions/,
  );
});

test("the demo wallet is told it is in a demo", () => {
  const answer = greeting({ ...CONNECTED, world: "demo", walletKind: "demo" });
  assert.match(texts(answer.blocks), /world running in this tab/);
});

test("suggestions never offer something the state cannot do", () => {
  assert.ok(!available(DISCONNECTED).includes("status"));
  assert.ok(available(DISCONNECTED).includes("help"));

  const paused = available({ ...CONNECTED, hasGuard: true, paused: true });
  assert.ok(paused.includes("resume"));
  assert.ok(!paused.includes("pause"));

  const running = available({ ...CONNECTED, hasGuard: true, paused: false });
  assert.ok(running.includes("pause"));
  assert.ok(!running.includes("resume"));
});

test("the same question twice gives the same answer", () => {
  // No randomness and no hidden state. A chat surface that varies its phrasing on a
  // risk readout invites the reader to wonder which one was right.
  assert.deepEqual(reply("what is my ltv", CONNECTED), reply("what is my ltv", CONNECTED));
});
