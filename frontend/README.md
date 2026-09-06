# Brace: web

Next.js App Router, TypeScript, Tailwind. The public site and chat application are
described by `LANDING.md` and `PLATFORM.md`.

- `/` and `/docs`: the public side, including the simulator, which needs no wallet.
- `/chat`: the agent, as a conversation. Direct routes remain available for
  `/chat/authorize`, `/chat/reserve`, `/chat/history`, `/chat/analytics`, and
  `/chat/faucet`.

```bash
yarn install
yarn dev        # http://localhost:3000
yarn test       # node:test through tsx, including the cross-implementation contracts
yarn lint
yarn build
```

## The world follows the wallet

Two worlds, and which one you are in is decided by which wallet you connect rather
than by a build flag.

**Phantom** reads real Kamino positions off the configured cluster when an RPC URL is
configured. Tracking a borrow needs no Brace write transaction, because the
obligations are Kamino's accounts: the app finds every position the address owns with
one `getProgramAccounts` filtered on the owner at offset 64, decodes the reserves for
symbols and prices, and renders the LTV from the obligation's own risk-adjusted
aggregates.

**The demo wallet** reads a world that lives in the browser tab. The price moves, the
watcher reports, the rule fires, the reserve goes down, and the failure paths are
switchable from the panel itself. It resets on reload.

What never happens is the mix: a fabricated position under somebody's own address is
the one combination that could mislead them about their own money.

The deployed Brace program is available on devnet. With an RPC URL and Phantom, the
app can authorize a guard, fund or withdraw its reserve, pause or revoke it, repay
from the reserve as the owner, and configure a repayment schedule. Mainnet is not
supported.

### Reading a position honestly

KLend only recomputes an obligation's values inside `refresh_obligation` and marks it
stale afterwards, so an account read between transactions can carry an older price,
or nothing at all if it has never been refreshed. `PositionSnapshot.refreshed`
carries that fact and the interface leads with it: an LTV nobody flagged is an LTV
somebody will act on. The liquidation threshold is likewise recomputed from the
deposit reserves rather than read from the obligation's cached field, which on
mainnet is often the sentinel 255.

## The wallet and the data source are explicit

Which wallet you connect and which data the panel shows are separate questions, and
the app answers them separately. Phantom is used whenever it is installed. You
connect your own address on the configured cluster, and the header links it to the
explorer. If no RPC URL is configured, the panel stays in the demo world and labels
that state instead of presenting fabricated values as chain data.

Without an extension the app offers the demo wallet instead, so the review path
survives. With one installed, that fallback is still one click away.

The cluster defaults to **devnet**. An address is the same on every cluster, so the
connect screen asks you to set Phantom to the same cluster. Balances and signed
transactions differ even though the address does not.

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_BRACE_CLUSTER` | `devnet` (default), `testnet` or `mainnet-beta`. Chooses the default endpoint and the explorer links. |
| `NEXT_PUBLIC_BRACE_RPC_URL` | JSON-RPC endpoint. Overrides the cluster default. Set a dedicated devnet endpoint for repeated polling. Without it the app stays in demo mode. |
| `NEXT_PUBLIC_BRACE_PROGRAM_ID` | Optional program id override. Defaults to the deployed Brace devnet program id. |
| `AGENT_ROUTER_API_KEY` | Server-only Agent Router key used by free-form chat questions. Never use the `NEXT_PUBLIC_` prefix. |
| `AGENT_ROUTER_BASE_URL` | Anthropic-compatible Agent Router endpoint. Defaults to `https://agentrouter.org`. |
| `AGENT_ROUTER_MODEL` | Router model id. Defaults to `claude-opus-4-8`. |
| `GEMINI_API_KEY` | Server-only Gemini key. When set, Gemini is used before Agent Router. |
| `GEMINI_MODEL` | Gemini model id. Defaults to `gemini-2.5-flash`. |

## Layout

```
lib/core/        The shared package. No React, no Next, no DOM.
  ltv/           The LTV contract of PLATFORM.md 4, pinned by the shared vectors
                 in ../program/vectors/ltv-bps.json.
  program.ts     The Rust constants, discriminators and error codes, mirrored and
                 pinned against the IDL by program.test.ts.
  policy.ts      PolicyParams::validate, mirrored, so a rule the chain would
                 reject is refused before a wallet opens.
  guard.ts       GuardConfig plus the derived readouts the panel renders.
  reserve.ts     What one firing costs and what a 20/30/40% fall costs.
  liveness.ts    Watcher and price freshness, with the sixty second bound from
                 the acceptance list.
  receipts.ts    The receipt model and the fixed phrasing of PLATFORM.md 2.6.
  tx/            Instruction encoding and account decoding, shared with the bot.

lib/platform/    The seam between the screens and the data.
  types.ts       GuardSource, and the closed list of failures from PLATFORM.md 6.
  demo-source.ts The browser world, including its fault switches.
  chain-source.ts Real JSON-RPC reads: Kamino positions and deployed devnet guards.
  kamino.ts      The KLend account layout, mirroring the Rust adapter and pinned
                 against committed mainnet bytes by kamino.test.ts.
  provider.tsx   TanStack Query, the wallet, and the one second panel poll.

lib/chat/        The deterministic command guide shared with the UI and future bot.
app/api/chat/    Server-only Agent Router Messages API route for free-form questions.
components/app/  The screens of PLATFORM.md 2.2 to 2.6, now rendered as answers.
components/chat/ The thread, the composer and the suggestion chips.
content/en.ts    Every visible string.
```

`lib/core` is the package `PLATFORM.md` section 5 requires the bot to share. It has
no framework imports and no DOM, so moving it into a workspace package when the bot
lands is a move rather than a rewrite.

## The chat

`/chat` is a conversation. Recognised commands stay in the pure `lib/chat/engine.ts`
guide so actions always render the guarded product screens. Free-form questions go to
the server-only `/api/chat` route, which calls Gemini when `GEMINI_API_KEY` is set,
otherwise Claude Opus 4.8 through the Anthropic-compatible Agent Router. The API key
is never shipped to the browser. If the provider is unavailable, the local guide
remains available.

When Agent Router is selected, the route uses the official Anthropic SDK so it receives
a standard Messages API request. A `content-blocked` response is returned verbatim in
the chat: it means the remote router rejected the request or the current key does not
include the selected model. Check the model entitlement in the Agent Router console
before changing the app.

The devnet test-borrow card also has `Close test position`. It reads the project-owned
Kamino obligation, repays the outstanding test debt from the wallet's own test-token
account, rereads the obligation, and returns the collateral in a second transaction.
The flow is restricted to the configured Brace test market and runs a simulation before
each wallet prompt. Devnet SOL is still needed for transaction fees; no real-value
asset is charged by the close operation.

Slash commands and familiar action phrases are matched on keywords rather than
parsed. When the local guide is used, an unclear command is refused instead of being
rounded to an action, because quietly reading "revoke" as "reserve" is worse than a
menu. Answers for recognised actions are the existing screens, not paragraphs
restating them: a second rendering of the same numbers is a second implementation
that can drift.

## What is not here yet

- The Telegram bot (`PLATFORM.md` section 3). `lib/chat` is framework free and is
  the half that moves there.
- A hosted watcher, public heartbeat endpoint, and failure notifications. The
  repository includes a reference watcher under `tools/devnet`, but it is not a
  hosted service.
- Indexed chain history. The app can show local demo receipts and reports the lack
  of indexed history explicitly for chain data.
