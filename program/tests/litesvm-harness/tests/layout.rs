//! Layout regression tests for `adapter/kamino.rs`.
//!
//! The adapter parses Kamino accounts by raw byte offset, so a KLend upgrade that
//! moves a field would silently change what the guard believes about a position.
//! `liquidation_threshold_pct` has already moved inside `ReserveConfig` between
//! releases, so this is not hypothetical.
//!
//! These tests pin the offsets from the outside: the fixtures write a field at the
//! offset read off upstream, and each test corrupts exactly one field and asserts the
//! compiled program noticed. Because the fixture offsets were derived independently
//! of the adapter's constants, agreement between them is evidence, not tautology.

use guard_litesvm_tests::{
    assert_guard_error,
    ids::err,
    kamino::{q60, BorrowFixture, OBLIGATION_LEN, RESERVE_LEN},
    TestEnv, HEALTHY_REPAY,
};
use solana_pubkey::Pubkey;

#[test]
fn obligation_owner_is_read_from_its_offset() {
    let mut env = TestEnv::new();
    env.obligation_state.owner = Pubkey::new_unique();
    env.install();
    assert_guard_error(
        env.repay(HEALTHY_REPAY),
        err::INVALID_MARKET_RELATIONSHIP,
    );
}

#[test]
fn obligation_lending_market_is_read_from_its_offset() {
    let mut env = TestEnv::new();
    env.obligation_state.lending_market = Pubkey::new_unique();
    env.install();
    assert_guard_error(
        env.repay(HEALTHY_REPAY),
        err::INVALID_MARKET_RELATIONSHIP,
    );
}

#[test]
fn reserve_lending_market_is_read_from_its_offset() {
    let mut env = TestEnv::new();
    env.debt_reserve_state.lending_market = Pubkey::new_unique();
    env.install();
    assert_guard_error(
        env.repay(HEALTHY_REPAY),
        err::INVALID_MARKET_RELATIONSHIP,
    );
}

#[test]
fn reserve_liquidity_mint_is_read_from_its_offset() {
    let mut env = TestEnv::new();
    env.debt_reserve_state.liquidity_mint = Pubkey::new_unique();
    env.install();
    assert_guard_error(
        env.repay(HEALTHY_REPAY),
        err::INVALID_MARKET_RELATIONSHIP,
    );
}

#[test]
fn reserve_liquidity_supply_is_read_from_its_offset() {
    let mut env = TestEnv::new();
    // The reserve names a different supply account than the one passed in. This is
    // the check that keeps repaid funds from being routed anywhere else.
    env.debt_reserve_state.liquidity_supply = Pubkey::new_unique();
    env.install();
    assert_guard_error(
        env.repay(HEALTHY_REPAY),
        err::INVALID_MARKET_RELATIONSHIP,
    );
}

#[test]
fn reserve_token_program_is_read_from_its_offset() {
    let mut env = TestEnv::new();
    env.debt_reserve_state.token_program = Pubkey::new_unique();
    env.install();
    assert_guard_error(
        env.repay(HEALTHY_REPAY),
        err::INVALID_MARKET_RELATIONSHIP,
    );
}

#[test]
fn obligation_borrow_entry_is_read_from_its_offset() {
    let mut env = TestEnv::new();
    // The configured debt reserve is no longer among the obligation's borrows.
    env.obligation_state.borrows =
        vec![BorrowFixture::new(Pubkey::new_unique(), q60(850), q60(850))];
    env.install();
    assert_guard_error(env.repay(HEALTHY_REPAY), err::MISSING_DEBT_POSITION);
}

#[test]
fn obligation_discriminator_is_checked() {
    let mut env = TestEnv::new();
    env.install();

    let mut data = env.account_data(&env.obligation);
    data[0] ^= 0xff;
    let owner = guard_litesvm_tests::ids::KLEND_PROGRAM_ID;
    let lamports = env.svm.minimum_balance_for_rent_exemption(data.len());
    env.svm
        .set_account(
            env.obligation,
            solana_account::Account {
                lamports,
                data,
                owner,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    assert_guard_error(env.repay(HEALTHY_REPAY), err::INVALID_EXTERNAL_ACCOUNT);
}

#[test]
fn account_sizes_match_upstream() {
    // KLend keeps both account sizes fixed across upgrades by shrinking padding, so
    // these are the anchors the offsets hang off.
    assert_eq!(OBLIGATION_LEN, 3_344);
    assert_eq!(RESERVE_LEN, 8_624);
}

#[test]
fn remaining_deposit_reserves_must_match_the_obligation() {
    let mut env = TestEnv::new();
    // The obligation lists a deposit reserve the caller did not pass.
    env.obligation_state.deposits = vec![env.collateral_reserve, Pubkey::new_unique()];
    env.install();
    assert_guard_error(
        env.repay(HEALTHY_REPAY),
        err::INVALID_REMAINING_ACCOUNTS,
    );
}
