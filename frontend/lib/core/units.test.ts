import assert from "node:assert/strict";
import test from "node:test";

import { formatAmount, formatTokenAmount, parseAmount, quote } from "./units";

test("parsing goes through digits, not through a float", () => {
  // Number("1234567.89") * 1e6 lands on 1234567889999.9998 and truncates to a value
  // one base unit below the amount on the screen.
  assert.deepEqual(parseAmount("1234567.89", 6), { ok: true, amount: 1_234_567_890_000n });
  assert.deepEqual(parseAmount("0.1", 6), { ok: true, amount: 100_000n });
  assert.deepEqual(parseAmount("0.000001", 6), { ok: true, amount: 1n });
});

test("a leading or trailing decimal point is still an amount", () => {
  assert.deepEqual(parseAmount(".5", 6), { ok: true, amount: 500_000n });
  assert.deepEqual(parseAmount("5.", 6), { ok: true, amount: 5_000_000n });
});

test("grouping separators are accepted, because people paste them", () => {
  assert.deepEqual(parseAmount("1,204.50", 6), { ok: true, amount: 1_204_500_000n });
});

test("more precision than the mint has is refused rather than rounded", () => {
  // Rounding here would show one amount and send another.
  assert.deepEqual(parseAmount("1.1234567", 6), { ok: false, reason: "too_precise" });
});

test("nonsense is refused with a reason the form can act on", () => {
  assert.deepEqual(parseAmount("", 6), { ok: false, reason: "empty" });
  assert.deepEqual(parseAmount("   ", 6), { ok: false, reason: "empty" });
  assert.deepEqual(parseAmount("abc", 6), { ok: false, reason: "not_a_number" });
  assert.deepEqual(parseAmount(".", 6), { ok: false, reason: "not_a_number" });
  assert.deepEqual(parseAmount("-5", 6), { ok: false, reason: "negative" });
});

test("formatting truncates, so a balance never reads higher than it is", () => {
  assert.equal(formatAmount(1_999_999n, 6), "1.99");
  assert.equal(formatAmount(1_000_000n, 6), "1.00");
  assert.equal(formatAmount(0n, 6), "0.00");
});

test("large amounts are grouped and stay exact past the float limit", () => {
  assert.equal(formatAmount(98_765_432_100_000_000n, 6), "98,765,432,100.00");
});

test("round trip through the parser is lossless", () => {
  for (const input of ["0.000001", "1.5", "1204.5", "98765432100"]) {
    const parsed = parseAmount(input, 6);
    assert.ok(parsed.ok);
    assert.equal(parseAmount(formatAmount(parsed.amount, 6, { maxFractionDigits: 6 }), 6).ok, true);
  }
});

test("a token amount is one phrasing everywhere", () => {
  assert.equal(formatTokenAmount(quote(1_204_500_000n)), "1,204.50 USDC");
});
