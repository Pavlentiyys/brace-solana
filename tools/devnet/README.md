# Devnet market tools

Creates a Kamino lending market on devnet that this project controls, and opens a
real borrow against it.

## Why this exists

You cannot open a new borrow on the Kamino markets that already sit on devnet. There
are 148 of them and 132 active reserves, but every usable collateral is a test mint
whose mint authority belongs to somebody else:

```
deUSX   authority MzoFtCNxiSWr72wpcdY5J8gzRCqWQCH3DSpNP6MUHnK
USDC    authority AhKNmBmaeq6XrrEyGnSQne3WeU4SoN7hSAGieTiqPaJX
sUSDC   authority 5RabYeYt19sor9RvExkiRvv1T9rWje5hPW7xeYXB6quQ
dUSDY   authority DWat3MjbT3HmHjwutDKqN9ooSNtVyFVgfTm3gs7drYS2
```

There is exactly one reserve on devnet holding real wrapped SOL, and it is configured
at a 0% loan-to-value and hidden, so it cannot back a loan either.

KLend is permissionless about market creation, so the answer is to create one. The
market this makes is a genuine Kamino market — real Pyth prices, real interest
accrual, real liquidation thresholds — and the only thing special about it is that we
hold the mint authority, so the collateral can be handed out.

## Use

```bash
npm install

npm run inspect                     # sanity: PDA derivation against live reserves
npm run market                      # mints, market, two reserves, config
npx tsx src/seed.ts                 # first price refresh, funds the debt reserve
npx tsx src/patch-borrow-limit.ts   # opens the debt side to ordinary obligations
npx tsx src/open-position.ts 2 100  # faucet, obligation, deposit 2 bSOL, borrow 100 bUSDC
npx tsx src/mint-to.ts <address> 1 debt # top up test bUSDC for accrued borrow interest
npx tsx src/refresh.ts <obligation> # recompute the aggregates so the app reads them
```

Everything signs with `~/.config/solana/id.json`; point `BRACE_KEYPAIR` elsewhere to
use another key. **The position belongs to whichever key signs**, because KLend
requires the obligation owner's signature on every step — so to see it in the web
app, connect that same key in Phantom.

The `mint-to` command is the local devnet faucet. A borrow accrues interest, so the
wallet may need a small bUSDC top-up before the test position can be closed. It uses
the project mint authority locally; that key is never sent to the browser or Vercel.

`market.json` holds every address the scripts created and is what the app reads.

## What is in the market

| | Collateral | Debt |
|---|---|---|
| Label | `bSOL`, 9 decimals | `bUSDC`, 6 decimals |
| Price | Pyth devnet SOL/USD | Pyth devnet USDC/USD |
| Loan to value | 75% | 0% |
| Liquidation threshold | 85% | 0% |

The debt side is deliberately 0% loan-to-value: it exists to be borrowed, not to back
a loan.

## Four things that are not obvious

**The reserve PDAs are seeded by the reserve address alone**, not by the market and
mint. The obvious guess produces four confident, wrong addresses and an account
mismatch with no explanation. `npm run inspect` checks the derivation against
reserves that already exist before anything is created.

**`skipConfigIntegrityValidation` is only accepted while a reserve is "predeposit"**,
and a reserve stops being predeposit the moment its deposit limit rises above zero.
Setting the limits early makes the very instruction that sets them fail its own
post-check. So everything else is written first under the skip, and the two limits go
last under full validation.

**`borrow_limit_outside_elevation_group` is a second cap**, separate from
`borrow_limit`, and it defaults to zero. An ordinary obligation is in no elevation
group, so until it is raised every borrow fails with `BorrowLimitExceeded` and a log
line reading `Left: 0` — that zero is the limit, not the amount.

**`refresh_obligation` wants exactly the reserves the obligation currently
references**, in order, and rejects a mismatch with `InvalidAccountInput`. A
hardcoded list works on the first run and fails on the second.

## Nothing here reaches the browser

Anchor and the IDL live in this package only. The web app talks to Kamino over plain
JSON-RPC reads and decodes accounts by offset in `frontend/lib/platform/kamino.ts`.

`idl/klend.json` is copied from `@kamino-finance/klend-sdk` and is version 1.25.0 —
the same release `program/programs/guard/src/adapter/kamino.rs` pins its offsets
against.
