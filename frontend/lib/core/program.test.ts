import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_ACTIONS_V1,
  ACTION_REPAY,
  DISCRIMINATORS,
  GUARD_ACCOUNT_DISCRIMINATOR,
  GUARD_ERRORS,
  MAX_DELEGATION_SECONDS,
  MIN_COOLDOWN_SECONDS,
  PROGRAM_ID,
  PROGRAM_IS_DEPLOYED,
  describeGuardError,
  guardErrorCode,
} from "./program";
import { ACCOUNT_ORDER } from "./tx/instructions";

/**
 * `program.ts` is a copy of the Rust, and a copy nobody checks is a copy that is
 * already wrong. These tests read the program's own files and fail on drift.
 *
 * `program/` and `frontend/` are separate repositories, so a frontend-only checkout
 * genuinely has neither. That skips with a message, the same way the shared LTV
 * vectors do: a contract test that vanishes quietly is worse than no contract test.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const IDL_PATH = join(HERE, "../../../program/idl/guard.json");
const STATE_PATH = join(HERE, "../../../program/programs/guard/src/state.rs");
const ERRORS_PATH = join(HERE, "../../../program/programs/guard/src/errors.rs");

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

interface Idl {
  address: string;
  instructions: {
    name: string;
    discriminator: number[];
    accounts: { name: string }[];
  }[];
  accounts: { name: string; discriminator: number[] }[];
  errors: { code: number; name: string }[];
}

const idlSource = read(IDL_PATH);
const stateSource = read(STATE_PATH);
const errorsSource = read(ERRORS_PATH);

if (idlSource === null) {
  test("program IDL contract", { skip: `not found at ${IDL_PATH}` }, () => {});
} else {
  const idl = JSON.parse(idlSource) as Idl;

  test("the program id matches the IDL", () => {
    assert.equal(PROGRAM_ID, idl.address);
  });

  test("the placeholder id is reported as not deployed", () => {
    // Anchor's default. While this is the address, there is nothing to link to and
    // the interface has to say so rather than offer an explorer link into the void.
    const isPlaceholder = idl.address === "Fg6PaFpoGXkYsidMpWxTWqkZpY6W2BeZ7FEfcYkgMQbS";
    assert.equal(PROGRAM_IS_DEPLOYED, !isPlaceholder);
  });

  for (const instruction of idl.instructions) {
    test(`discriminator matches the IDL: ${instruction.name}`, () => {
      const mirrored = DISCRIMINATORS[instruction.name as keyof typeof DISCRIMINATORS];
      assert.ok(mirrored, `${instruction.name} is missing from DISCRIMINATORS`);
      assert.deepEqual([...mirrored], instruction.discriminator);
    });

    test(`account order matches the IDL: ${instruction.name}`, () => {
      const mirrored = ACCOUNT_ORDER[instruction.name as keyof typeof ACCOUNT_ORDER];
      assert.ok(mirrored, `${instruction.name} is missing from ACCOUNT_ORDER`);
      assert.deepEqual(
        [...mirrored],
        instruction.accounts.map((account) => account.name),
      );
    });
  }

  test("every mirrored instruction still exists in the IDL", () => {
    const names = new Set(idl.instructions.map((instruction) => instruction.name));
    for (const name of Object.keys(DISCRIMINATORS)) {
      assert.ok(names.has(name), `${name} is mirrored here but gone from the program`);
    }
  });

  test("the GuardConfig account discriminator matches the IDL", () => {
    const account = idl.accounts.find((candidate) => candidate.name === "GuardConfig");
    assert.ok(account, "GuardConfig is missing from the IDL");
    assert.deepEqual(GUARD_ACCOUNT_DISCRIMINATOR, account.discriminator);
  });

  test("error codes and names match the IDL", () => {
    assert.deepEqual(
      GUARD_ERRORS.map((error) => error.name),
      idl.errors.map((error) => error.name),
    );
    for (const error of idl.errors) {
      assert.equal(
        guardErrorCode(error.name as (typeof GUARD_ERRORS)[number]["name"]),
        error.code,
        `${error.name} should be ${error.code}`,
      );
    }
  });
}

if (stateSource === null) {
  test("program constants contract", { skip: `not found at ${STATE_PATH}` }, () => {});
} else {
  test("MIN_COOLDOWN_SECONDS matches state.rs", () => {
    const match = stateSource.match(/MIN_COOLDOWN_SECONDS: u32 = (\d+)/);
    assert.ok(match, "could not find MIN_COOLDOWN_SECONDS in state.rs");
    assert.equal(MIN_COOLDOWN_SECONDS, Number(match[1]));
  });

  test("MAX_DELEGATION_SECONDS matches state.rs", () => {
    const match = stateSource.match(/MAX_DELEGATION_SECONDS: i64 = ([\d *]+);/);
    assert.ok(match, "could not find MAX_DELEGATION_SECONDS in state.rs");
    const product = match[1]
      .split("*")
      .map((factor) => Number(factor.trim()))
      .reduce((left, right) => left * right, 1);
    assert.equal(MAX_DELEGATION_SECONDS, product);
  });

  test("v1 permits repay and nothing else", () => {
    // `PolicyParams::validate` rejects any other mask, and the authorization screen
    // renders its capability list from this constant.
    assert.match(stateSource, /allowed_actions == ACTION_REPAY/);
    assert.equal(ALLOWED_ACTIONS_V1, ACTION_REPAY);
  });
}

if (errorsSource === null) {
  test("guard error contract", { skip: `not found at ${ERRORS_PATH}` }, () => {});
} else {
  test("error names and order match errors.rs", () => {
    const names = [...errorsSource.matchAll(/^ {4}([A-Z][A-Za-z]+),$/gm)].map((match) => match[1]);
    assert.deepEqual(
      GUARD_ERRORS.map((error) => error.name),
      names,
    );
  });
}

test("an unmapped error code is reported as unknown rather than guessed", () => {
  const described = describeGuardError(9_999);
  assert.match(described.name, /Unknown error 9999/);
  assert.match(described.cause, /does not recognise/);
});

test("GuardExpired is 6002", () => {
  assert.equal(guardErrorCode("GuardExpired"), 6_002);
  assert.equal(describeGuardError(6_002).name, "GuardExpired");
});
