# Brace: web

Next.js App Router, TypeScript, Tailwind. Two halves, described by `LANDING.md` and
`PLATFORM.md`.

- `/` and `/docs`: the public side, including the simulator, which needs no wallet.
- `/app`: the agent, as a conversation. The screens it used to be are still here and
  are what the bot answers with; `/app/history` remains as a direct route.

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

**Phantom** reads real Kamino positions off the cluster. Tracking a borrow needs
nothing of ours deployed, because the obligations are Kamino's accounts: the app
finds every position the address owns with one `getProgramAccounts` filtered on the
owner at offset 64, decodes the reserves for symbols and prices, and renders the LTV
from the obligation's own risk-adjusted aggregates. Kamino is live on devnet — 148
markets, 235 funded reserves — so this works today.

**The demo wallet** reads a world that lives in the browser tab. The price moves, the
watcher reports, the rule fires, the reserve goes down, and the failure paths are
switchable from the panel itself. It resets on reload.

What never happens is the mix: a fabricated position under somebody's own address is
the one combination that could mislead them about their own money.

Writing is still gated on deployment. `declare_id!` holds Anchor's placeholder, so
every action returns `program_not_deployed` and the screens say so before showing
what the signature will ask for.

### Reading a position honestly

KLend only recomputes an obligation's values inside `refresh_obligation` and marks it
stale afterwards, so an account read between transactions can carry an older price,
or nothing at all if it has never been refreshed. `PositionSnapshot.refreshed`
carries that fact and the interface leads with it: an LTV nobody flagged is an LTV
somebody will act on. The liquidation threshold is likewise recomputed from the
deposit reserves rather than read from the obligation's cached field, which on
mainnet is often the sentinel 255.

## The wallet is real even while the world is not

Which wallet you connect and which data the panel shows are separate questions, and
the app answers them separately. Phantom is used whenever it is installed — you
connect your own address, on the configured cluster, and the header links it to the
explorer. The panel behind it still renders the demo world until the program is
deployed, and the banner says exactly that rather than letting a recognisable address
imply the numbers are real too.

Without an extension the app offers the demo wallet instead, so the review path
survives. With one installed, that fallback is still one click away.

The cluster defaults to **devnet**. An address is the same on every cluster, so
nothing detects a "wrong network" for you — the connect screen asks you to set
Phantom to the same cluster, because balances and simulation differ even though the
address does not.

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_BRACE_CLUSTER` | `devnet` (default), `testnet` or `mainnet-beta`. Chooses the default endpoint and the explorer links. |
| `NEXT_PUBLIC_BRACE_RPC_URL` | JSON-RPC endpoint. Overrides the cluster default. Without it the app is always in demo mode, because a public endpoint cannot serve a one second poll. |
| `NEXT_PUBLIC_BRACE_PROGRAM_ID` | Deployed program id. While it is the placeholder, the app stays in demo mode and says why. |
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
  chain-source.ts Real JSON-RPC reads: Kamino positions today, guards once deployed.
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

`/app` is a conversation. Recognised commands stay in the pure `lib/chat/engine.ts`
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

Slash commands and familiar action phrases are matched on keywords rather than
parsed. When the local guide is used, an unclear command is refused instead of being
rounded to an action, because quietly reading "revoke" as "reserve" is worse than a
menu. Answers for recognised actions are the existing screens, not paragraphs
restating them: a second rendering of the same numbers is a second implementation
that can drift.

## What is not here yet

- The Telegram bot (`PLATFORM.md` section 3). `lib/chat` is framework free and is
  the half that moves there.
- Transaction assembly and signing. The instruction bytes are in `lib/core/tx`; the
  assembler goes next to them once there is a deployed program to sign against.
- A watcher. `watcherLastCheckAt` is null against a cluster, which the panel reports
  as unknown rather than as healthy.
