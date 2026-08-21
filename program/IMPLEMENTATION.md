# Implementation notes

Companion to [README.md](README.md), which is the specification. This file records
what was verified, what was measured, and what is deliberately still open. Read it
before changing the Kamino adapter or the dependency pins.

**An audit is required before this program takes real funds.** Nothing below
substitutes for one.

---

## 1. The §9 questions, answered

### Is repayment permissive?

**Yes.** This is the assumption v1 is built on, and it holds.

KLend's `RepayObligationLiquidity` account struct declares `pub owner: Signer<'info>`
but never constrains it to equal `obligation.owner`, and neither the handler nor
`lending_checks::repay_obligation_liquidity_checks` adds that comparison. The signer
is only the authority of the source token account.

Verified twice over: by reading
[handler_repay_obligation_liquidity.rs](https://github.com/Kamino-Finance/klend/blob/master/programs/klend/src/handlers/handler_repay_obligation_liquidity.rs)
upstream, and empirically — `tests/litesvm-harness/tests/real_klend.rs` runs the real
mainnet KLend binary and repays an obligation whose owner is a keypair that never
signs anything. The guard's vault PDA signs instead.

So the position stays where it is and no migration or wrapped-obligation model is
needed. `TOP_UP` still requires the owner and remains out of v1.

### What does the obligation state look like?

Fixed-point: KLend's `Fraction` is `U68F60`, so every `_sf` field is a `u128` with
**60 fractional bits**. That is `math::FRACTIONAL_BITS`.

Offsets, verified field by field against KLend `master` and then against real mainnet
bytes (`tests/litesvm-harness/tests/mainnet_layout.rs`). All offsets include the
8-byte Anchor discriminator.

| Obligation (3344 bytes)                    | Offset | Type   |
| ------------------------------------------ | -----: | ------ |
| `last_update.slot`                         |     16 | u64    |
| `last_update.stale`                        |     24 | u8     |
| `last_update.price_status`                 |     25 | u8     |
| `lending_market`                           |     32 | Pubkey |
| `owner`                                    |     64 | Pubkey |
| `deposits[8]`, stride 136                  |     96 | struct |
| `deposits[i].deposit_reserve`              |    +0  | Pubkey |
| `deposits[i].market_value_sf`              |   +40  | u128   |
| `lowest_reserve_deposit_liquidation_ltv`   |   1184 | u64    |
| `deposited_value_sf`                       |   1192 | u128   |
| `borrows[5]`, stride 200                   |   1208 | struct |
| `borrows[i].borrow_reserve`                |    +0  | Pubkey |
| `borrows[i].cumulative_borrow_rate_bsf`    |   +32  | 48 B   |
| `borrows[i].borrowed_amount_sf`            |   +88  | u128   |
| `borrows[i].market_value_sf`               |  +104  | u128   |
| `borrows[i].borrow_factor_adjusted_market_value_sf` | +120 | u128 |
| `borrow_factor_adjusted_debt_value_sf`     |   2208 | u128   |
| `has_debt`                                 |   2288 | u8     |

| Reserve (8624 bytes)                | Offset | Type   |
| ----------------------------------- | -----: | ------ |
| `last_update.slot`                  |     16 | u64    |
| `last_update.stale`                 |     24 | u8     |
| `last_update.price_status`          |     25 | u8     |
| `lending_market`                    |     32 | Pubkey |
| `liquidity`                         |    128 | struct |
| `liquidity.mint_pubkey`             |    +0  | Pubkey |
| `liquidity.supply_vault`            |   +32  | Pubkey |
| `liquidity.total_available_amount`  |   +96  | u64    |
| `liquidity.cumulative_borrow_rate_bsf` | +168 | 48 B  |
| `liquidity.token_program`           |  +280  | Pubkey |
| `config`                            |   4848 | struct |
| `config.loan_to_value_pct`          |   +16  | u8     |
| `config.liquidation_threshold_pct`  |   +17  | u8     |

Two independent consistency checks fall out of the mainnet fixtures and are asserted
as tests: `deposited_value_sf` equals the sum of the per-deposit `market_value_sf`,
and `borrow_factor_adjusted_debt_value_sf` equals the sum of the per-borrow adjusted
values. Neither could hold if an offset were wrong.

The adapter pins `KLEND_LAYOUT_VERSION`, checks owner, discriminator and a minimum
length, and fails closed otherwise. That catches most incompatible upgrades; a
same-size field reorder still requires a new release, which is what the layout tests
are for. **`config.liquidation_threshold_pct` has already moved once** (offset 26 in
older releases, 17 today), so treat this table as perishable.

### Does the protocol account for borrow factor?

**Yes, and so do we.** The guard reads `borrow_factor_adjusted_debt_value_sf` — the
aggregate KLend itself uses — rather than summing raw borrow amounts. No independent
spot-price computation happens anywhere in the program, per §6.

### What is the compute budget?

Measured in LiteSVM, printed by the tests:

| Path                                     | Compute units |
| ---------------------------------------- | ------------: |
| `execute_action` + mock KLend CPI        |        51,733 |
| `execute_action` + **real** KLend repay  |       169,024 |

169k is under the 200k default, but the agent must also prepend `refresh_reserve`
(one per deposit reserve) and `refresh_obligation`, which are not counted here.

**Consequence for the client: always prepend an explicit
`ComputeBudgetInstruction::set_compute_unit_limit`.** Budget roughly 400k for a
single-collateral position and measure again for multi-collateral ones. The ТЗ's
fallback — splitting into two transactions inside one Jito bundle — is not needed at
these numbers, and would only come into play for positions with many deposit
reserves.

---

## 2. Findings that changed the code

### The clamp bricked underwater positions

`ltv_bps` returns a `u16` and clamps at 10000. `validate_post_cpi_health` used to
require `ltv_after < ltv_before`, which **can never hold above 100% LTV** — both
sides read 10000 — so the guard refused to repay exactly the positions in the most
danger. A sharp drop produces such positions routinely, before liquidators catch up.

Found by the §10 fuzzing, not by a hand-written case. The improvement check now runs
on the exact risk-adjusted debt value; the clamped LTV is only compared non-strictly.
Pinned by `underwater_position_can_still_be_repaid`.

### An un-refreshed obligation disarmed the liquidation-threshold check

`lowest_reserve_deposit_liquidation_ltv` is only populated by `refresh_obligation`.
A real mainnet obligation, sampled between transactions, carries the sentinel **255**
— which this adapter read as 25500 bps, making every "the trigger must sit below the
liquidation threshold" comparison pass vacuously, in `init_guard` and `update_policy`
as well as `execute_action`.

`PositionState::checked_liquidation_ltv_bps` now rejects anything outside 1..=10000
as a stale obligation. The sentinel is observed on live bytes in
`mainnet_layout.rs`, so the case is real and not defensive programming.

### `update_policy` locked the owner out after a full repay

It used the strict parser, which requires the configured borrow to still exist. KLend
removes a borrow entry when it is fully repaid, so a user who cleared their debt could
no longer re-arm the policy. It now uses the tolerant parser.

### The debt reserve's own liquidation threshold was dead weight

`ReserveState` parsed `liquidation_threshold_pct` and nothing ever read it. It is also
the single most layout-fragile field in the adapter. Removed — the obligation's
`lowest_reserve_deposit_liquidation_ltv` is the correct, conservative bound over the
deposit side, and the debt reserve's threshold says nothing about when *this* position
gets liquidated.

---

## 3. Layout of the repository

Three Cargo workspaces, deliberately not one:

```
Cargo.toml                     on-chain workspace, Solana 2.1.7 / Rust 1.79 SBF
  programs/guard/              the program
tests/litesvm-harness/         own workspace, LiteSVM + Solana 2.2 host runtime
tests/mock-klend/              own workspace, a stand-in KLend for SBF
```

They are split because they cannot be unified. `guard` pins
`solana-program = "=2.1.7"` because that is what Anchor.toml declares, and LiteSVM
needs 2.2 or newer; one lockfile cannot satisfy both. So **the harness does not depend
on the `guard` crate at all** — it talks to the compiled `guard.so` the way any
external client would, with hand-packed account bytes and raw discriminators. That is
a feature: a test that reuses the program's own constants and serialisation cannot
detect a change in either.

### Dependency pins, and why `cargo update` is dangerous here

The SBF toolchain ships **Cargo 1.79, which cannot parse a manifest declaring Edition
2024 at all** — not compile it, parse it. A plain `cargo update` on a modern host
pulls such crates in transitively and breaks `cargo build-sbf` with an error naming a
crate nobody added on purpose.

Two mitigations are in place:

- `.cargo/config.toml` sets `resolver.incompatible-rust-versions = "fallback"`, so
  resolution honours `rust-version = "1.79"`. Cargo 1.79 ignores the key with a
  harmless warning.
- Crates that declare **no** `rust-version` escape that mechanism and are pinned in
  the lockfile by hand: `blake3 = 1.5.5` (1.8 pulls `digest 0.11` → `crypto-common
  0.2` → Edition 2024) and `getrandom = 0.3.1` (0.3.4 pulls `wasip2` →
  `wit-bindgen`, Edition 2024, via proptest's `rand`).

If `cargo build-sbf` ever fails with `feature 'edition2024' is required`, that is what
happened. Re-pin the offender rather than upgrading the toolchain, which is fixed by
Anchor.toml.

### Cargo's two registry caches

Cargo ≥1.85 and Cargo 1.79 hash the registry index into **different** cache
directories, so crates the host toolchain has already downloaded are invisible to the
SBF build, which then re-downloads them and can stall. If a build hangs with no CPU
use, that is why. Fix:

```bash
cp -n ~/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/*.crate \
      ~/.cargo/registry/cache/index.crates.io-6f17d22bba15001f/
cargo build-sbf --manifest-path programs/guard/Cargo.toml -- --offline
```

---

## 4. Build, test, lint

```bash
# Unit tests, proptest and the shared LTV vectors
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Both SBF binaries (drop `-- --offline` on the first run)
cargo build-sbf --manifest-path programs/guard/Cargo.toml
cargo build-sbf --manifest-path tests/mock-klend/Cargo.toml

# The LiteSVM suite: ТЗ §10's negative cases, layout regressions, real KLend
cargo test --manifest-path tests/litesvm-harness/Cargo.toml

# Optional, for tests/real_klend.rs — 10 MB, not committed, skips when absent
solana program dump -u m KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
    tests/litesvm-harness/fixtures/klend.so
```

`anchor build` is **not** the supported path: the installed `anchor-cli` is 1.1.2
while Anchor.toml pins 0.31.1. Use `cargo build-sbf` directly. `idl/guard.json` is
committed and only needs regenerating when the public interface changes.

### The shared LTV vectors

`vectors/ltv-bps.json` is the §7 contract. It is read by `math.rs::shared_vectors_agree`
on the Rust side and by `frontend/lib/ltv/shared-vectors.test.ts` on the TypeScript
side, so a drift in either turns exactly one of them red.

The contract is: scale by BPS **before** dividing, and **truncate** toward zero. The
program additionally clamps to 10000 because it stores a `u16`; the file records both
the exact and the clamped value. Clamping cannot change a decision — every trigger is
at most 10000 — so off-chain implementations report the unclamped number.

The frontend has two entry points, and the distinction matters. `ltvBpsFromValues`
takes `bigint` and implements the contract exactly; it is what any code reading a live
obligation must use, because the `U68F60` values are `u128` and no float holds them.
`ltvBps(position, price)` is the **simulator** path: its inputs are floats, so a true
ratio of 6000 arrives as 5999.9999999999995 and truncation would report 5999 — an
invented basis point, in the direction that flatters the position. It rounds to
nearest instead. Exact inputs truncate; estimated inputs round; nothing compares one
against the other.

---

## 5. Test coverage

| Suite | Count | What it establishes |
| ----- | ----: | ------------------- |
| `cargo test --workspace` | 42 | Pure logic, policy validation, shared vectors, two proptest properties |
| `tests/execute_action.rs` | 22 | Every §10 negative case as a real transaction |
| `tests/withdraw.rs` | 6 | The exit guarantee: revoked, expired, paused |
| `tests/layout.rs` | 10 | Each adapter offset, pinned from outside |
| `tests/mainnet_layout.rs` | 3 | The same offsets against committed mainnet bytes |
| `tests/real_klend.rs` | 1 | The CPI, accepted by the real KLend binary |
| `tests/litesvm.rs` | 3 | Harness sanity and the compute-budget measurement |

The §10 fuzzing is the two proptest properties: `repay_never_increases_ltv` (safety
*and* liveness — an honest repay must also be accepted) and
`repay_only_ever_debits_the_vault_and_credits_the_reserve_supply`.

---

## 6. Known limits

- **v1 is REPAY-only.** `TOP_UP` needs the owner's signature and the wrapped-obligation
  model; `PolicyParams::validate` rejects it outright rather than accepting a flag that
  does nothing.
- **`init_guard` requires an existing borrow** in the configured debt reserve, and an
  obligation that has been refreshed (otherwise the liquidation threshold is a
  sentinel). A guard cannot be set up before borrowing.
- **`declare_id!` is the Anchor placeholder** `Fg6PaFpo…`. Pin the real address at
  deploy time and regenerate the IDL then.
- **The mainnet fixtures are a snapshot**, not a live feed. They will keep passing
  against stale bytes after a KLend upgrade — refresh them when bumping
  `KLEND_LAYOUT_VERSION`.
- **`real_klend.rs` patches the reserve's freshness and the supply vault balance** to
  make a snapshot usable. It proves the CPI shape and the repay path; it is not a
  substitute for a devnet or mainnet-fork rehearsal of the full
  refresh → refresh → execute cycle with live oracles.
- **No integration test drives `refresh_reserve` / `refresh_obligation`.** Those need
  live oracle accounts. The compute figure above is therefore a floor.
