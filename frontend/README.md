# Brace: web

Next.js App Router, TypeScript, Tailwind. Two halves, described by `LANDING.md` and
`PLATFORM.md`.

- `/` and `/docs`: the public side, including the simulator, which needs no wallet.
- `/app`: the signed-in panel, which covers the four operations that require a
  signature (authorization, funding the reserve, withdrawing it, revoking) and the
  position readout. Everything else in the product belongs to the chat.

```bash
yarn install
yarn dev        # http://localhost:3000
yarn test       # node:test through tsx, including the cross-implementation contracts
yarn lint
yarn build
```

## The app runs against a demo world

The program in `../program` is not deployed: `declare_id!` still holds Anchor's
placeholder. Rather than render an empty panel, `/app` runs against a world that
lives in the browser tab. The price moves, the watcher reports, the rule fires, the
reserve goes down, and the failure paths are switchable from the panel itself.

Every screen fed by it says so, and its receipts carry no explorer link, because
there is no transaction to link to. The world resets on reload.

To point the app at a cluster instead, set both of these and deploy the program:

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_BRACE_RPC_URL` | JSON-RPC endpoint. Without it the app is always in demo mode. |
| `NEXT_PUBLIC_BRACE_PROGRAM_ID` | Deployed program id. While it is the placeholder, the app stays in demo mode and says why. |

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
  chain-source.ts Real JSON-RPC reads, switched on when the program is deployed.
  provider.tsx   TanStack Query, the wallet, and the one second panel poll.

components/app/  The screens of PLATFORM.md 2.2 to 2.6.
content/en.ts    Every visible string.
```

`lib/core` is the package `PLATFORM.md` section 5 requires the bot to share. It has
no framework imports and no DOM, so moving it into a workspace package when the bot
lands is a move rather than a rewrite.

## What is not here yet

- The Telegram bot (`PLATFORM.md` section 3).
- The Kamino obligation reader, which is what `chain-source` needs before it can
  show a live position. The layout is in `../program/programs/guard/src/adapter`.
- Transaction assembly and signing. The instruction bytes are in `lib/core/tx`; the
  wallet and the assembler go next to them once there is a deployed program to sign
  against.
