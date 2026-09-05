# Brace Frontend Platform

Brace is a chat-first web application for inspecting Kamino positions, modeling
liquidation scenarios, configuring a repayment guard, and signing the owner-only
operations that control it.

This document describes the implemented browser platform and separates it from the
services that are still planned.

## Current status

| Area | Status |
|---|---|
| Landing page and simulator | Implemented |
| Browser chat and deterministic commands | Implemented |
| Demo wallet and failure simulation | Implemented |
| Phantom connection and devnet reads | Implemented |
| Guard authorization, reserve, pause, and revoke transactions | Implemented |
| Devnet faucet and test-position flow | Implemented |
| Hosted watcher and public liveness endpoint | Not provided |
| Indexed on-chain action history | Not provided |
| Telegram bot | Product direction, not implemented in this repository |
| Mainnet support | Not deployed or supported |

The frontend must not imply that a planned service is live. Unknown watcher status,
missing indexed history, and unsupported actions are rendered as explicit states.

## Product principles

### 1. Explain authority before asking for it

The user should be able to answer two questions before signing:

- What can the delegated agent do?
- What can it never do?

The authorization screen builds its capability list from constants mirrored from the
program and pinned by tests. The current program permits repayment only. Collateral
top-up is marked as v2 and cannot be authorized by the current UI.

### 2. Keep wallet operations narrow

Reading a public Kamino obligation does not require a signature. The wallet is used
only when an operation changes state:

- create or update an authorization;
- fund the reserve;
- withdraw the reserve;
- pause, resume, or revoke the guard;
- open and refresh a test position on devnet.

Every proposed action is described before the wallet opens.

### 3. Never hide degraded states

An unavailable RPC, stale position, exhausted reserve, expired authorization,
rejected wallet request, or failed transaction must produce a specific visible state.
The interface never turns a failed read into an empty or reassuring dashboard.

### 4. Do not promise safety or profitability

Brace executes a policy; it does not predict prices. The simulator includes scenarios
where the reserve is exhausted or acting is worse than repaying earlier. Product copy
reports what happened without claiming that Brace "saved" a position.

## Runtime worlds

The application has two data sources behind one interface.

### Demo world

The demo world runs entirely in the browser tab:

- no extension or credentials are required;
- no RPC request or transaction is submitted;
- policy changes and receipts are simulated;
- state resets on reload or through the reset control;
- failure controls can force RPC, watcher, reserve, expiry, and transaction errors.

The demo banner is persistent. Demo receipts never link to a block explorer because
they do not have transaction signatures.

### Chain world

When an injected wallet is used, the application reads the connected address's real
Kamino accounts from the configured Solana cluster.

The supported deployment is devnet:

- Kamino obligations, reserves, and market names are read over JSON-RPC;
- guard accounts are read from the deployed Brace program;
- signed operations use the injected wallet;
- explorer links include the devnet query;
- a dedicated RPC URL is recommended for polling.

The demo and chain worlds never mix. A real wallet is not shown a fabricated position
under its own address.

## Information architecture

### Public site

| Route | Purpose |
|---|---|
| `/` | Product explanation, live simulator, limitations, and entry point |
| `/docs` | Documentation overview |
| `/docs/getting-started` | First-use flow |
| `/docs/exit` | How to revoke and withdraw |

The public site is written for a borrower who already understands LTV. Security
boundaries and limitations appear before marketing claims.

### Application

| Route | Purpose |
|---|---|
| `/app` | Chat-first position overview and command entry point |
| `/app/authorize` | Review and sign a guard policy |
| `/app/reserve` | Fund or withdraw the guard reserve |
| `/app/history` | Display available action receipts |
| `/app/faucet` | Request devnet SOL |

The application is designed mobile-first and must remain usable at 375 px without
horizontal page scrolling.

## Core user flows

### Explore without a wallet

1. Open the landing page.
2. Change collateral, debt, reserve, or market scenario inputs.
3. Compare the position with the agent, without the agent, and with the reserve
   repaid up front.
4. Open `/app` with the demo wallet.
5. Trigger failure states deliberately before connecting a real wallet.

### Inspect a real position

1. Connect Phantom or another compatible injected Solana wallet.
2. Confirm that the application is pointed at devnet.
3. The chain source discovers Kamino obligations owned by the connected address.
4. Reserve and market accounts are decoded into a position snapshot.
5. Stale values are labeled before LTV is presented.

Connecting exposes only the public address. It does not grant agent authority or move
funds.

### Authorize a guard

1. Select a supported obligation with an existing borrow.
2. Enter or confirm the trigger, target, action cap, window, cooldown, and expiry.
3. Validate the policy against the same limits mirrored from the program.
4. Show what the agent can and cannot do.
5. Build `init_guard` with the configured devnet agent.
6. Ask the owner wallet to sign and send.

If the canonical guard PDA already exists, the UI reports that the position is
already authorized instead of opening a transaction that is expected to fail.

### Fund and withdraw the reserve

Deposits and withdrawals are owner-signed operations. Amounts are parsed as decimal
strings and converted to native token units without floating-point rounding.

`null` withdrawal amount means "withdraw everything" and is encoded as the program's
`u64::MAX` sentinel. The program resolves the current vault balance on chain, so the
UI does not need to trust a balance read that may become stale before signing.

### Pause, resume, and revoke

Pausing uses `update_policy` and resends the currently stored policy so limits are not
silently reset. Revocation is a distinct one-step operation.

The position panel keeps pause, revoke, and reserve withdrawal visible. The exit path
must not be hidden behind a confirmation chain or account-retention flow.

### Open a devnet test position

The repository contains a dedicated KLend devnet market because existing public
devnet markets do not provide usable collateral that the project can distribute.

The test-position UI can:

1. deposit the project's devnet collateral;
2. borrow the configured debt asset;
3. refresh the obligation so the application can read current aggregate values.

Each step is signed by the obligation owner because KLend requires that authority.

## Browser chat

The `/app` conversation maps plain-language requests and slash commands to the same
screens used by direct navigation.

Supported deterministic intents include:

- positions and status;
- reserve management;
- authorization;
- history;
- pause and resume;
- revoke;
- wallet and help.

When an input does not match a known command, the assistant lists what it understands
instead of guessing an operation that could move funds.

Free-form questions may use the server-side `/api/chat` route. Gemini is attempted
when its server credential is configured, with Agent Router as the fallback. API keys
are never exposed through `NEXT_PUBLIC_*` variables.

Model output is not trusted as transaction data. Proposed actions are parsed into a
strict schema, normalized, and checked against program policy constraints before any
wallet prompt is shown.

Chats are stored in browser storage and can be deleted locally. They are bounded in
length so an old thread cannot grow without limit.

## Data architecture

| Data | Current source |
|---|---|
| Kamino obligations and LTV inputs | Solana JSON-RPC account reads |
| Reserve and lending market metadata | Solana JSON-RPC account reads |
| Brace guard configuration | Brace program accounts |
| Guard reserve balance | SPL token account balance |
| Connected wallet balance | Sum of token accounts for the debt mint |
| Simulator inputs | Committed deterministic scenarios |
| Demo receipts | In-browser demo state |
| Chain receipts | Not indexed yet |
| Watcher status | Unknown until a hosted liveness source exists |

Kamino accounts are treated as untrusted bytes. Decoders check discriminators, minimum
lengths, and expected layouts before producing UI values.

## Shared LTV contract

The program and frontend consume the same vectors from
[`../program/vectors/ltv-bps.json`](../program/vectors/ltv-bps.json).

Exact on-chain values use `bigint` and truncate after scaling by basis points. The
historical simulator accepts estimated floating-point inputs and rounds to the nearest
basis point to avoid showing a one-basis-point improvement caused only by binary float
representation.

Tests pin both behaviors and keep exact account data separate from simulation data.

## Frontend architecture

```text
app/                     Next.js routes and server API
components/
  landing/               public product sections
  simulator/             scenario controls, chart, and results
  chat/                  conversation and action proposals
  app/                   wallet-connected product screens
lib/
  core/                  framework-free LTV, policy, guard, and encoding logic
  platform/              RPC, Kamino decoding, wallet, transactions, and data sources
  chat/                  deterministic commands, parsing, threads, and engine
  scenarios/             committed simulator scenarios
content/                 centralized English product copy
```

The boundary is deliberate:

- `lib/core` does not import React, wallet code, or `@solana/web3.js`;
- chain and demo sources implement the same `GuardSource` interface;
- transaction data encoding is tested separately from wallet integration;
- program constants, discriminators, account order, and errors are pinned against the
  committed IDL and Rust source.

## Technology stack

| Area | Technology |
|---|---|
| Framework | Next.js 16 App Router and React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 with project-specific components |
| Data cache | TanStack Query 5 |
| Wallet and transactions | Injected wallet boundary and `@solana/web3.js` 1.98 |
| Documentation | MDX |
| Motion | Motion 13 |
| Tests | Node test runner through `tsx` |

The application does not use `@solana/wallet-adapter` or the Anchor browser client.
Reads are plain JSON-RPC; `@solana/web3.js` is confined to wallet and transaction
modules.

## Configuration

Public browser configuration:

```dotenv
NEXT_PUBLIC_BRACE_CLUSTER=devnet
NEXT_PUBLIC_BRACE_RPC_URL=https://your-devnet-rpc.example
```

Server-only optional chat configuration is documented in [`.env.example`](.env.example).
Real keys must never be committed or prefixed with `NEXT_PUBLIC_`.

## Error and degradation states

The UI has explicit outcomes for:

- wallet unavailable, rejected, or disconnected;
- invalid policy or duplicate guard;
- insufficient reserve or wallet funds;
- unsupported cluster;
- unavailable or rate-limited RPC;
- stale obligation or oracle data;
- expired, paused, or revoked authorization;
- cooldown and action-window limits;
- congested or expired transaction;
- unknown program error;
- missing watcher heartbeat;
- failed automated action.

Unknown errors keep their original detail for debugging but are never presented as a
successful or safe state.

## Acceptance criteria

- The simulator works without a wallet.
- Adverse scenarios are available beside the successful scenario, not hidden in a
  footnote.
- A real wallet reads only real chain positions.
- Demo state is unmistakably labeled and never produces explorer links.
- Every signing flow explains the proposed operation before opening the wallet.
- The authorization screen derives current capabilities from program constants.
- A policy rejected by the program is rejected before signing.
- Reserve withdrawal remains available after pause, expiry, and revocation.
- Stale account values are labeled before LTV is shown.
- The panel fits a 375 px viewport without horizontal page scrolling.
- Unknown chat input does not produce a guessed transaction.
- Shared vectors keep Rust and TypeScript LTV behavior aligned.
- Watcher status is reported as unknown when no liveness source exists.

The human acceptance test is simple: after one minute, a first-time user should be
able to explain what the agent can do with reserve funds and what it cannot do. If
they cannot, the interface has failed its primary trust requirement.

## Planned work

- hosted watcher and heartbeat endpoint;
- indexed chain receipts and explorer-linked history;
- immediate notification when an automated action fails;
- production-ready independent exit instructions;
- Telegram or another external notification interface;
- audited mainnet deployment;
- v2 collateral top-up with an owner-authorized position model.
