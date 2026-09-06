# Brace Guard Program

Brace is a policy-constrained Solana program that repays debt on an existing Kamino
KLend position from a reserve funded by the borrower.

The delegated agent is intentionally less powerful than the owner. It can request a
repay through `execute_action`, but it cannot change the policy, withdraw the reserve,
choose a transfer destination, or act after the authorization expires or is revoked.

## Deployment status

| Item | Status |
|---|---|
| Network | Solana devnet |
| Program ID | [`CCSVvtVuDpH1wCCQWExCpdmZ1sqUBabJA1QQGai7aVaY`](https://solscan.io/account/CCSVvtVuDpH1wCCQWExCpdmZ1sqUBabJA1QQGai7aVaY?cluster=devnet) |
| Mainnet | Not deployed |
| Audit | Not audited |
| Current action | `REPAY` only |

An independent security audit is required before the program is used with real
funds. Tests and implementation notes are not a substitute for an audit.

## Design goals

The program is built around five properties:

1. **Narrow delegation.** The agent can execute one policy-constrained action.
2. **No arbitrary recipient.** Repay funds can only reach the supply vault recorded
   by the configured Kamino debt reserve.
3. **Live validation.** Every execution rechecks the position, reserve, oracle status,
   policy limits, and trigger using current on-chain accounts.
4. **Atomic failure.** A failed validation or CPI rolls back the entire transaction.
5. **Unconditional owner exit.** The owner can withdraw the reserve while the guard
   is paused, expired, or revoked.

## Why repayment does not require position migration

Kamino repayment is permissive: the authority of the source token account does not
have to be the owner of the obligation. The Brace vault PDA can therefore repay an
existing obligation without moving the position into a wrapper account.

This behavior is verified in two ways:

- against the upstream KLend repayment account and handler definitions;
- with a LiteSVM test that loads the real KLend binary and repays an obligation whose
  owner does not sign the transaction.

Collateral top-up is different because depositing collateral requires the obligation
owner. It remains a v2 design and is rejected by the current policy validator.

## Instructions

| Instruction | Signer | Purpose |
|---|---|---|
| `init_guard` | Owner | Creates the guard and vault PDAs and stores the initial policy and delegated agent |
| `deposit_reserve` | Owner | Transfers debt-mint tokens from an owner-controlled account into the guard vault |
| `withdraw_reserve` | Owner | Returns some or all reserve funds to an owner-controlled token account |
| `update_policy` | Owner | Replaces policy limits, changes the agent, and pauses or resumes execution |
| `revoke` | Owner | Pauses the guard, expires it immediately, and clears all allowed actions |
| `execute_action` | Agent | Validates the live position and performs the constrained KLend repayment CPI |
| `owner_repay` | Owner | Repays from the reserve on the owner's signature, without agent policy limits |
| `migrate_guard` | Owner | Expands an authorization written by an older account layout |

There is no generic transfer instruction and no destination argument on
`execute_action`.

## Accounts and PDAs

Each authorization creates two program-derived addresses:

```text
guard PDA = ["guard", owner, obligation]
vault PDA = ["vault", guard PDA]
```

The guard PDA makes one authorization canonical for an owner and obligation pair.
The vault is both the token account and its own token authority; it signs repayments
through program-derived seeds.

### `GuardConfig`

```rust
pub struct GuardConfig {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub obligation: Pubkey,
    pub lending_market: Pubkey,
    pub debt_reserve: Pubkey,
    pub vault: Pubkey,
    pub vault_mint: Pubkey,

    pub trigger_ltv_bps: u16,
    pub target_ltv_bps: u16,
    pub max_action_amount: u64,
    pub max_actions_per_window: u8,
    pub window_seconds: u32,
    pub cooldown_seconds: u32,
    pub allowed_actions: u8,

    pub expires_at: i64,
    pub paused: bool,

    pub last_action_at: i64,
    pub window_started_at: i64,
    pub actions_in_window: u8,
    pub total_actions: u32,
    pub total_repaid: u64,

    pub bump: u8,
    pub vault_bump: u8,
}
```

## Policy constraints

The current validator requires:

- `target_ltv_bps < trigger_ltv_bps <= 10_000`;
- a positive per-action amount cap;
- at least one permitted action per window;
- a positive window duration;
- a cooldown of at least 30 seconds;
- `allowed_actions == ACTION_REPAY`;
- an expiry in the future and no more than 90 days away;
- a trigger below the obligation's checked liquidation threshold.

LTV is represented in basis points because risk increases in one direction: a higher
LTV is worse. This keeps threshold comparisons and boundary tests explicit.

## `execute_action` validation flow

The watcher normally prepends Kamino reserve and obligation refresh instructions.
The guard then validates all conditions again before invoking KLend:

1. The signer matches the delegated agent.
2. The guard is active and has not expired.
3. The cooldown and action-window limits permit another action.
4. The requested action is exactly `ACTION_REPAY`.
5. The amount is positive and does not exceed the policy cap or vault balance.
6. The obligation and debt reserve are owned by the canonical KLend program.
7. The obligation owner, lending market, debt reserve, mint, supply vault, and token
   program match the values pinned by the guard.
8. The obligation and reserve are not stale, their refresh slots are no more than two
   slots behind, and Kamino's oracle checks pass.
9. Every deposit reserve referenced by the obligation is supplied in the correct
   order.
10. Current LTV is at or above the configured trigger.
11. The requested repay value cannot overshoot the configured target.
12. The program invokes KLend's `repay_obligation_liquidity_v2` instruction.
13. After the CPI, the vault balance must decrease, collateral value must remain
    unchanged, and risk-adjusted debt must decrease.
14. Only after every postcondition passes are counters and totals updated.

Because the trigger is evaluated at execution time, a delayed or durable-nonce
transaction cannot rely on the market state that existed when it was prepared.

## Fixed external programs

The program does not accept lending program IDs from the caller:

```rust
pub const KLEND_PROGRAM_ID: Pubkey =
    pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const FARMS_PROGRAM_ID: Pubkey =
    pubkey!("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
```

Both accounts must also be executable. The lending market authority is checked as
the canonical KLend PDA derived from `['lma', lending_market]`.

## Kamino adapter

`adapter/kamino.rs` isolates every KLend-specific detail:

- account owners and Anchor discriminators;
- pinned obligation and reserve layout versions;
- `U68F60` fixed-point fields;
- risk-adjusted debt values, including borrow factors;
- reserve relationships and token program selection;
- oracle and freshness status;
- account order for `repay_obligation_liquidity_v2`.

The on-chain program deliberately does not depend on the Kamino SDK. SDK updates
therefore cannot change the build transitively, while layout regressions are detected
by tests against committed mainnet account bytes.

Layout offsets and the verification history are documented in
[`IMPLEMENTATION.md`](IMPLEMENTATION.md).

## Math

The pure math module is independent of Anchor. It calculates LTV and the repay value
required to approach a target using integer arithmetic and wider intermediates.

Kamino values are fixed-point `U68F60` integers. The program reads the aggregate,
borrow-factor-adjusted values already maintained by KLend instead of recomputing the
position from independent spot prices.

The shared contract is:

```text
LTV basis points = floor(debt_value * 10,000 / collateral_value)
```

The on-chain representation clamps reported LTV to 10,000 basis points, but health
improvement after repayment is checked against exact risk-adjusted debt. This allows
an underwater position to improve even when both displayed LTV values remain clamped
at 100%.

[`vectors/ltv-bps.json`](vectors/ltv-bps.json) is consumed by both Rust and TypeScript
tests so rounding changes cannot silently diverge between the program and frontend.

## Owner exit guarantee

`withdraw_reserve` depends only on:

- the owner signature;
- the guard, vault, mint, and owner destination relationships;
- a positive amount not exceeding the current vault balance.

It does not check pause state, expiry, or allowed actions. Passing `u64::MAX` requests
the entire current vault balance, avoiding a stale off-chain balance read.

Dedicated LiteSVM tests cover withdrawal after pause, expiry, and revocation.

## Repository layout

```text
program/
  programs/guard/              on-chain Anchor workspace
    src/adapter/kamino.rs      KLend layout and CPI boundary
    src/instructions/          eight instruction handlers
    src/math.rs                pure fixed-point calculations
    src/state.rs               guard account and policy constants
  tests/litesvm-harness/       external transaction-level test workspace
  tests/mock-klend/            minimal SBF test double at the KLend program ID
  vectors/                     cross-language math vectors
  idl/guard.json               committed Anchor IDL
```

The program, LiteSVM harness, and mock KLend program are separate Cargo workspaces.
The on-chain program pins Solana 2.1.7, while the host-side LiteSVM runtime requires a
newer Solana crate graph.

## Build and test

Requirements:

- Rust and Cargo;
- Solana CLI 2.1.7 with the SBF toolchain;
- the dependency versions pinned in the committed lockfiles.

```bash
cd program

cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

cargo build-sbf --manifest-path programs/guard/Cargo.toml
cargo build-sbf --manifest-path tests/mock-klend/Cargo.toml
cargo test --manifest-path tests/litesvm-harness/Cargo.toml
```

`anchor build` is not the supported build path for this repository. Use
`cargo build-sbf` so the build follows the pinned Solana SBF toolchain.

The optional real-KLend CPI test requires the uncommitted 10 MB program binary:

```bash
solana program dump -u m KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
  tests/litesvm-harness/fixtures/klend.so
```

Without the ELF, that case exits early and the remaining suite stays offline-capable.

## Test coverage

| Suite | Count | Coverage |
|---|---:|---|
| Guard unit and property tests | 42 | Policy validation, fixed-point math, shared vectors, replay behavior, and safety properties |
| LiteSVM harness | 45 | Negative cases, withdrawal invariants, layouts, compute measurement, mock CPI, and optional real KLend CPI |

The property tests establish that repayment never increases position risk and that
the repayment path only debits the guard vault and credits the configured reserve
supply vault.

## Known limitations

- v1 supports debt repayment only. `TOP_UP` is rejected; scheduled repayment is a
  separate debt-repayment grant with its own interval and amount cap.
- One guard is tied to one owner, one obligation, and one debt reserve.
- `init_guard` requires an existing borrow and a usable refreshed liquidation
  threshold.
- The deployed program is on devnet only and has not been audited.
- Committed KLend fixtures are snapshots and must be refreshed when the pinned layout
  changes.
- The real-KLend test proves the CPI account shape and repayment path, not a complete
  live-oracle refresh cycle.
- The repository includes a reference watcher but does not provide a hosted keeper or
  public liveness service.

For measured compute usage, dependency pins, external account offsets, and previously
resolved implementation failures, see [`IMPLEMENTATION.md`](IMPLEMENTATION.md).
