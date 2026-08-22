<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.svg">
  <img alt="Brace" src=".github/logo-light.svg" width="470">
</picture>

<br>

[![Solana](https://img.shields.io/badge/Solana-2.1.7-14F195?logo=solana&logoColor=white)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-2E3440?logo=rust&logoColor=white)](https://www.anchor-lang.com)
[![Rust](https://img.shields.io/badge/Rust-1.79%20SBF-CE422B?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.3-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Kamino](https://img.shields.io/badge/Kamino-devnet%20live-4b8fff)](https://kamino.finance)

[![Tests](https://img.shields.io/badge/tests-255%20passing-3fb950)](#testing)
[![Program](https://img.shields.io/badge/program-not%20deployed-d29922)](#status)
[![Audit](https://img.shields.io/badge/audit-required-f85149)](#status)
[![License](https://img.shields.io/badge/license-MIT-8a9099)](#license)

</div>

---

## What this is

A Solana program and a web app for one job: **repay part of a Kamino loan
automatically, when the position gets close to liquidation, under limits the borrower
sets in advance.**

You deposit a reserve of USDC, write a rule ("when my LTV reaches 80%, repay down to
70%, at most 200 USDC per action, at most twice an hour"), and authorize an agent key.
The agent can then do exactly one thing: call `execute_action`, which repays debt from
your vault into Kamino's reserve. That is the only instruction that moves your money,
and it has no parameter for a destination.

The guarantee is structural, not a promise:

- There is **no instruction that transfers to an arbitrary address.** The agent cannot
  send funds anywhere, because the program cannot express it.
- Every action is gated on **live account data read in the same transaction.** A
  pre-signed transaction held for later fails when the condition no longer holds —
  the durable-nonce vector the specification was written against, covered by the
  `durable_nonce_replay_rejected` test.
- **Withdrawal is never blocked.** Not by a pause, not by expiry, not by revocation.
  Three tests exist solely to prove the exit stays open.
- The agent's authority **expires**, at most 90 days out, so delegation has to be
  renewed deliberately.

### Status

The program is **not deployed**. `declare_id!` still holds Anchor's placeholder, so
every write in the app returns `program_not_deployed` and says so on screen rather
than opening a wallet prompt that cannot succeed.

**Reading works today.** Tracking a Kamino position needs nothing of ours deployed,
because the obligations are Kamino's accounts. Connect Phantom on devnet and the app
finds every position your address holds.

**An audit is required before this takes real funds.** Nothing in this repository
substitutes for one.

---

## Layout

```
program/     The on-chain guard. Rust, Anchor 0.31.
  programs/guard/src/
    lib.rs           six instructions
    state.rs         GuardConfig, the policy and its limits
    math.rs          LTV and repay maths, pure, no Anchor
    adapter/kamino.rs  KLend account layout and the repay CPI
  tests/
    litesvm-harness/ the negative-case suite, plus real mainnet bytes
    mock-klend/      a stand-in KLend, loaded at the real program id
  vectors/           the cross-implementation LTV contract

frontend/    Next.js. The landing page, the simulator and the agent.
  lib/core/        framework-free: LTV, policy, guard state, instruction encoding
  lib/platform/    the seam: Kamino reads, the demo world, the wallet
  lib/chat/        the bot, as a pure function
  components/      the screens, which the bot answers with
```

Two documents are the specification and are worth reading before the code:
[`program/README.md`](program/README.md) for the on-chain side and
[`frontend/PLATFORM.md`](frontend/PLATFORM.md) for the product.
[`program/IMPLEMENTATION.md`](program/IMPLEMENTATION.md) records what was verified and
measured, and what is deliberately still open.

---

## Running it

### The web app

Everything on the front end runs with no keys and no cluster.

```bash
cd frontend
yarn install
yarn dev            # http://localhost:3000
```

Open `http://localhost:3000/app`. Without a wallet extension you get the demo world;
with Phantom you get your own Kamino positions off devnet.

Optional configuration:

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_BRACE_CLUSTER` | `devnet` (default), `testnet` or `mainnet-beta`. |
| `NEXT_PUBLIC_BRACE_RPC_URL` | Your own endpoint. The public one rate limits quickly. |
| `NEXT_PUBLIC_BRACE_PROGRAM_ID` | Set once the program is deployed. |

### The program

Needs the Rust toolchain, the Solana CLI 2.1.7 and Anchor 0.31.1.

```bash
cd program
cargo test --workspace                    # 42 unit tests, proptest, shared vectors
cargo clippy --workspace --all-targets -- -D warnings

cargo build-sbf --manifest-path programs/guard/Cargo.toml
cargo build-sbf --manifest-path tests/mock-klend/Cargo.toml
cargo test --manifest-path tests/litesvm-harness/Cargo.toml   # 45 tests
```

> `anchor build` is **not** the supported path here: the installed `anchor-cli` and
> the pinned `Anchor.toml` version differ. Use `cargo build-sbf` directly. If a build
> fails with `feature 'edition2024' is required`, read the dependency-pinning section
> of [`IMPLEMENTATION.md`](program/IMPLEMENTATION.md) before touching the toolchain.

One optional test runs the guard's CPI against the **real** KLend binary. It skips
when the 10 MB ELF is absent:

```bash
solana program dump -u m KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
    tests/litesvm-harness/fixtures/klend.so
```

---

## Using it

`/app` is a conversation. Ask in plain words; the bot answers with the actual panels
rather than paragraphs describing them.

**1. Connect.** Phantom is used whenever it is installed. Set Phantom to Devnet under
Settings → Developer Settings: an address is the same on every cluster, but balances
and simulation are not. Without an extension, the demo wallet opens a world that runs
in the browser tab, resets on reload, and can be made to fail on demand.

**2. Ask about the position.** "How close am I to liquidation?" returns your LTV, the
liquidation threshold, and the gap between them. If Kamino has not refreshed the
position since its last transaction, the bot says so *before* it gives you the number.

**3. Set a rule.** The authorization screen lists what the agent will be able to do,
generated from the program's own limits rather than written by hand.

**4. Fund the reserve, and take it back whenever you want.** The withdraw instruction
checks your signature and nothing else.

The bot understands roughly: `positions`, `status`, `reserve`, `authorize`, `history`,
`pause`, `resume`, `revoke`, `wallet`, `help` — in your own phrasing, or as
`/commands`. When nothing matches, it says so and lists what it does understand. It
never guesses at something that moves money.

### Which world you are in

The world follows the wallet, and the two never mix:

| Wallet | Positions | Writes |
|---|---|---|
| Phantom | Real, read from Kamino on the configured cluster | Blocked until the program is deployed |
| Demo wallet | A world in your browser tab | Simulated, including the failure paths |

A fabricated position under somebody's own address is the one combination that could
mislead them about their own money, so it is not offered.

---

## Technologies

**On chain**

- **Rust** with **Anchor 0.31.1**, built for **Solana 2.1.7** (SBF, Rust 1.79)
- **No Kamino SDK.** The KLend account layout and the `repay_obligation_liquidity_v2`
  CPI are implemented directly in `adapter/kamino.rs`, so a Kamino SDK release cannot
  break the build. The offsets are pinned against committed mainnet bytes.
- **`uint`** for 256-bit intermediates, because Kamino's `U68F60` fixed-point values
  overflow `u128` when multiplied
- **LiteSVM** for the negative-case suite, **proptest** for the two properties ТЗ §10
  requires: LTV never increases, and funds only ever reach the reserve's supply vault

**Web**

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript 5**
- **Tailwind CSS v4**, **Motion** for animation, **MDX** for the docs
- **TanStack Query** for the polling and cache layer
- **No wallet adapter.** Phantom is reached through its own injected provider, in one
  ~200 line module that covers detection, eager reconnect and account switching. A
  full adapter brings a modal, an autoconnect state machine and a wallet list, none of
  which can be exercised until there is a program to sign against.
- **web3.js on the write path only.** Reads are plain JSON-RPC `fetch`; the account
  decoding is in `lib/platform/kamino.ts`. Signing needs a real `Transaction` for
  Phantom, so web3.js is imported by one module. Still no Anchor in the browser.
- `node:test` through **tsx** for the suite

---

## Testing

| Suite | Count | What it establishes |
|---|---:|---|
| `program` unit + proptest | 42 | Policy validation, LTV maths, shared vectors, the two fuzz properties |
| `program` LiteSVM | 45 | Every negative case as a real transaction, layout regressions, real KLend |
| `frontend` | 168 | LTV contract, guard state, the Kamino decoder, the bot |

Two things worth calling out.

**The LTV formula lives in four implementations and they are pinned to each other.**
[`program/vectors/ltv-bps.json`](program/vectors/ltv-bps.json) is read by a Rust test
and by a TypeScript test, so a drift in either turns exactly one of them red.

**The guard's CPI is verified against the real KLend program**, not only against a
mock. `tests/real_klend.rs` loads mainnet's actual KLend binary into LiteSVM with real
market and reserve accounts, and asserts that the repay goes through — 169,024 compute
units for the guard plus the repay, which is why a client must prepend an explicit
`ComputeBudget` instruction.

---

## Opening a test position

The Kamino markets that already exist on devnet cannot be borrowed from: every usable
collateral is a test mint whose authority belongs to somebody else, and the one real
wrapped SOL reserve is set to 0% loan-to-value and hidden. So `tools/devnet` creates a
market — a genuine KLend market on live Pyth prices — where the mint authority is ours
and the collateral can be handed out.

```bash
cd tools/devnet && npm install
npm run market                      # mints, market, two reserves
npx tsx src/seed.ts                 # first price refresh, funds the debt side
npx tsx src/patch-borrow-limit.ts
npx tsx src/fund.ts <your address>  # collateral, no signature needed from you
```

Then open the position in the app: ask the bot to "open a test borrow". It has to be
your signature — KLend requires the obligation owner to sign the deposit and the
borrow, so nobody can open a position on somebody else's behalf.

## Known limits

- **v1 repays debt and nothing else.** `TOP_UP` needs the owner's signature and a
  wrapped-obligation model; the program rejects the flag rather than accepting one
  that does nothing.
- **`init_guard` requires an existing borrow** in the configured reserve, and an
  obligation that has been refreshed.
- **No watcher runs yet**, so the panel reports the last check as unknown rather than
  as healthy.
- **No transaction assembly.** The instruction bytes are in `lib/core/tx`; the
  assembler goes next to them once there is a deployed program to sign against.
- **The agent does not always help.** Repaying into a fall with no rebound spends the
  reserve and delays liquidation rather than preventing it. The simulator on the
  landing page reproduces all three cases, including the two where the rule costs you
  money.

## License

MIT, as declared in `program/Cargo.toml`.
