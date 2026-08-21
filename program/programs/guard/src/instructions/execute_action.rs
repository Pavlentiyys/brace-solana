use anchor_lang::{prelude::*, solana_program::sysvar::instructions as instructions_sysvar};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    adapter::{kamino::Kamino, MarketAdapter, RepayAccounts},
    errors::GuardError,
    events::ActionExecuted,
    math::{
        adjusted_repay_value, adjusted_value_for_borrow_reduction, ltv_bps, repay_value_for_target,
    },
    state::{
        GuardConfig, ACTION_REPAY, FARMS_PROGRAM_ID, KLEND_PROGRAM_ID, LENDING_MARKET_AUTH_SEED,
        MAX_OBLIGATION_STALENESS_SLOTS, SEED_GUARD, SEED_VAULT,
    },
};

#[derive(Accounts)]
pub struct ExecuteAction<'info> {
    #[account(
        mut,
        seeds = [SEED_GUARD, guard.owner.as_ref(), guard.obligation.as_ref()],
        bump = guard.bump,
        has_one = obligation,
        has_one = lending_market,
        has_one = debt_reserve,
        has_one = vault,
        has_one = vault_mint
    )]
    pub guard: Box<Account<'info, GuardConfig>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, guard.key().as_ref()],
        bump = guard.vault_bump,
        token::mint = vault_mint,
        token::authority = vault,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub agent: Signer<'info>,
    /// CHECK: Address and Kamino-owned layout are validated before use and after CPI.
    #[account(mut, owner = KLEND_PROGRAM_ID)]
    pub obligation: UncheckedAccount<'info>,
    /// CHECK: Fixed by guard and validated through the obligation/reserve relationship.
    #[account(owner = KLEND_PROGRAM_ID)]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: Address and Kamino-owned layout are validated before use.
    #[account(mut, owner = KLEND_PROGRAM_ID)]
    pub debt_reserve: UncheckedAccount<'info>,
    pub vault_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = vault_mint,
        token::token_program = token_program
    )]
    pub reserve_liquidity_supply: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Canonical KLend PDA; Anchor validates seeds under the external program ID.
    #[account(
        seeds = [LENDING_MARKET_AUTH_SEED, lending_market.key().as_ref()],
        bump,
        seeds::program = KLEND_PROGRAM_ID
    )]
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: Fixed address and executable bit prevent arbitrary CPI.
    #[account(
        address = KLEND_PROGRAM_ID @ GuardError::UnexpectedProgram,
        executable
    )]
    pub lending_program: UncheckedAccount<'info>,
    /// CHECK: Fixed address; required by KLend v2 even when farm accounts are None.
    #[account(
        address = FARMS_PROGRAM_ID @ GuardError::UnexpectedProgram,
        executable
    )]
    pub farms_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: Fixed sysvar address; KLend uses it for transaction introspection.
    #[account(address = instructions_sysvar::ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
}

pub fn execute_action_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ExecuteAction<'info>>,
    action_kind: u8,
    amount: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let guard = &ctx.accounts.guard;

    let next_window = validate_execution_policy(
        guard,
        ctx.accounts.agent.key(),
        clock.unix_timestamp,
        action_kind,
        amount,
        ctx.accounts.vault.amount,
    )?;

    let position_before = Kamino::read_position(
        &ctx.accounts.obligation.to_account_info(),
        &ctx.accounts.debt_reserve.key(),
    )?;
    let debt_reserve = Kamino::read_reserve(&ctx.accounts.debt_reserve.to_account_info())?;

    validate_relationships(&ctx, &position_before, &debt_reserve)?;
    validate_freshness(
        clock.slot,
        position_before.last_update_slot,
        position_before.stale,
        position_before.price_status,
    )?;
    validate_freshness(
        clock.slot,
        debt_reserve.last_update_slot,
        debt_reserve.stale,
        debt_reserve.price_status,
    )?;
    Kamino::validate_remaining_deposits(
        &position_before,
        ctx.remaining_accounts,
        &guard.lending_market,
    )?;

    let ltv_before = validate_pre_cpi_health(guard, &position_before, amount)?;

    let guard_key = guard.key();
    let vault_bump = guard.vault_bump;
    let vault_balance_before = ctx.accounts.vault.amount;
    let signer_seeds: &[&[u8]] = &[SEED_VAULT, guard_key.as_ref(), &[vault_bump]];

    Kamino::repay_cpi(
        RepayAccounts {
            vault_authority: &ctx.accounts.vault.to_account_info(),
            obligation: &ctx.accounts.obligation.to_account_info(),
            lending_market: &ctx.accounts.lending_market.to_account_info(),
            debt_reserve: &ctx.accounts.debt_reserve.to_account_info(),
            reserve_liquidity_mint: &ctx.accounts.vault_mint.to_account_info(),
            reserve_liquidity_supply: &ctx.accounts.reserve_liquidity_supply.to_account_info(),
            vault: &ctx.accounts.vault.to_account_info(),
            token_program: &ctx.accounts.token_program.to_account_info(),
            instruction_sysvar: &ctx.accounts.instruction_sysvar.to_account_info(),
            lending_market_authority: &ctx.accounts.lending_market_authority.to_account_info(),
            lending_program: &ctx.accounts.lending_program.to_account_info(),
            farms_program: &ctx.accounts.farms_program.to_account_info(),
            remaining_deposit_reserves: ctx.remaining_accounts,
        },
        amount,
        &[signer_seeds],
    )?;

    ctx.accounts.vault.reload()?;
    let repaid_amount = vault_balance_before
        .checked_sub(ctx.accounts.vault.amount)
        .ok_or(GuardError::PostCpiInvariant)?;
    require!(
        repaid_amount > 0 && repaid_amount <= guard.max_action_amount,
        GuardError::PostCpiInvariant
    );

    let position_after = Kamino::read_position_after_repay(
        &ctx.accounts.obligation.to_account_info(),
        &ctx.accounts.debt_reserve.key(),
    )?;
    let ltv_after = validate_post_cpi_health(guard, &position_before, &position_after, ltv_before)?;

    let guard = &mut ctx.accounts.guard;
    guard.record_action(clock.unix_timestamp, next_window, repaid_amount)?;

    emit!(ActionExecuted {
        guard: guard.key(),
        agent: ctx.accounts.agent.key(),
        obligation: guard.obligation,
        requested_amount: amount,
        repaid_amount,
        ltv_before_bps: ltv_before,
        ltv_after_bps: ltv_after,
        slot: clock.slot,
    });
    Ok(())
}

fn validate_relationships(
    ctx: &Context<'_, '_, '_, '_, ExecuteAction<'_>>,
    position: &crate::adapter::PositionState,
    reserve: &crate::adapter::ReserveState,
) -> Result<()> {
    let guard = &ctx.accounts.guard;
    require_keys_eq!(
        position.owner,
        guard.owner,
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        position.lending_market,
        guard.lending_market,
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        reserve.lending_market,
        guard.lending_market,
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        reserve.liquidity_mint,
        guard.vault_mint,
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        reserve.liquidity_supply,
        ctx.accounts.reserve_liquidity_supply.key(),
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        reserve.token_program,
        ctx.accounts.token_program.key(),
        GuardError::InvalidMarketRelationship
    );
    Ok(())
}

fn validate_freshness(
    current_slot: u64,
    last_update_slot: u64,
    stale: bool,
    price_status: u8,
) -> Result<()> {
    require!(!stale, GuardError::StaleObligation);
    let elapsed = current_slot
        .checked_sub(last_update_slot)
        .ok_or(GuardError::StaleObligation)?;
    require!(
        elapsed <= MAX_OBLIGATION_STALENESS_SLOTS,
        GuardError::StaleObligation
    );
    require!(
        Kamino::oracle_checks_pass(price_status),
        GuardError::StaleOracle
    );
    Ok(())
}

fn validate_execution_policy(
    guard: &GuardConfig,
    agent: Pubkey,
    now: i64,
    action_kind: u8,
    amount: u64,
    vault_amount: u64,
) -> Result<crate::state::WindowState> {
    require_keys_eq!(agent, guard.agent, GuardError::UnauthorizedAgent);
    require!(!guard.paused, GuardError::GuardPaused);
    require!(now < guard.expires_at, GuardError::GuardExpired);

    if guard.total_actions > 0 {
        let since_last_action = now
            .checked_sub(guard.last_action_at)
            .ok_or(GuardError::ClockMovedBackwards)?;
        require!(
            since_last_action >= i64::from(guard.cooldown_seconds),
            GuardError::CooldownActive
        );
    }

    let next_window = guard.next_window(now)?;
    require!(
        next_window.actions < guard.max_actions_per_window,
        GuardError::RateLimitExceeded
    );
    require!(
        action_kind == ACTION_REPAY && action_kind & guard.allowed_actions != 0,
        GuardError::ActionNotAllowed
    );
    require!(amount > 0, GuardError::InvalidAmount);
    require!(
        amount <= guard.max_action_amount && amount <= vault_amount,
        GuardError::AmountExceedsLimit
    );
    Ok(next_window)
}

fn validate_pre_cpi_health(
    guard: &GuardConfig,
    position: &crate::adapter::PositionState,
    amount: u64,
) -> Result<u16> {
    require!(
        guard.trigger_ltv_bps < position.checked_liquidation_ltv_bps()?,
        GuardError::InvalidPolicy
    );
    let ltv_before = map_math(ltv_bps(
        position.collateral_value_sf,
        position.debt_value_sf,
    ))?;
    require!(
        ltv_before >= guard.trigger_ltv_bps,
        GuardError::TriggerNotMet
    );

    let requested_repay_value = map_math(adjusted_repay_value(
        position.debt_borrowed_amount_sf,
        position.debt_adjusted_market_value_sf,
        amount,
    ))?;
    require!(requested_repay_value > 0, GuardError::ActionWouldNotImprove);
    let required_repay_value = map_math(repay_value_for_target(
        position.collateral_value_sf,
        position.debt_value_sf,
        guard.target_ltv_bps,
    ))?;
    require!(
        requested_repay_value <= required_repay_value,
        GuardError::Overcorrection
    );
    Ok(ltv_before)
}

fn validate_post_cpi_health(
    guard: &GuardConfig,
    before: &crate::adapter::PositionState,
    after: &crate::adapter::PositionState,
    ltv_before: u16,
) -> Result<u16> {
    require!(
        after.collateral_value_sf == before.collateral_value_sf,
        GuardError::PostCpiInvariant
    );
    let borrow_reduction_sf = before
        .debt_borrowed_amount_sf
        .checked_sub(after.debt_borrowed_amount_sf)
        .ok_or(GuardError::PostCpiInvariant)?;
    require!(borrow_reduction_sf > 0, GuardError::ActionWouldNotImprove);
    let adjusted_reduction_sf = map_math(adjusted_value_for_borrow_reduction(
        before.debt_borrowed_amount_sf,
        before.debt_adjusted_market_value_sf,
        borrow_reduction_sf,
    ))?;
    let debt_after_sf = before
        .debt_value_sf
        .checked_sub(adjusted_reduction_sf)
        .ok_or(GuardError::PostCpiInvariant)?;

    // Improvement is asserted on the exact risk-adjusted debt value, not on the LTV
    // in basis points. `ltv_bps` clamps to BPS because it returns a `u16`, so an
    // underwater position — one whose true LTV is above 100%, which is exactly what a
    // sharp drop produces before liquidators arrive — reads as 10000 both before and
    // after any repay. A strict comparison on the clamped value can never hold there,
    // and the guard would refuse to act precisely when the position most needs it.
    //
    // With collateral pinned unchanged above, a strict fall in debt value is both
    // necessary and sufficient for the position to have improved, and it holds at
    // every magnitude. A repay too small to move the risk-adjusted value fails here,
    // which is correct: it would spend a rate-limit slot and buy nothing.
    require!(
        debt_after_sf < before.debt_value_sf,
        GuardError::ActionWouldNotImprove
    );

    let ltv_after = map_math(ltv_bps(after.collateral_value_sf, debt_after_sf))?;
    // Non-strict: the reported LTV must never get worse, but it is allowed to be
    // unchanged where the clamp hides a real improvement.
    require!(
        ltv_after <= ltv_before,
        GuardError::ActionWouldNotImprove
    );
    require!(
        ltv_after >= guard.target_ltv_bps,
        GuardError::Overcorrection
    );
    Ok(ltv_after)
}

fn map_math<T>(result: core::result::Result<T, crate::math::MathError>) -> Result<T> {
    result.map_err(|_| error!(GuardError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn guard(agent: Pubkey) -> GuardConfig {
        GuardConfig {
            owner: Pubkey::new_unique(),
            agent,
            obligation: Pubkey::new_unique(),
            lending_market: Pubkey::new_unique(),
            debt_reserve: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            vault_mint: Pubkey::new_unique(),
            trigger_ltv_bps: 8_000,
            target_ltv_bps: 7_000,
            max_action_amount: 1_000,
            max_actions_per_window: 2,
            window_seconds: 3_600,
            cooldown_seconds: 30,
            allowed_actions: ACTION_REPAY,
            expires_at: 2_000,
            paused: false,
            last_action_at: 900,
            window_started_at: 500,
            actions_in_window: 0,
            total_actions: 1,
            total_repaid: 0,
            bump: 1,
            vault_bump: 1,
        }
    }

    fn validate(
        guard: &GuardConfig,
        agent: Pubkey,
        now: i64,
        action: u8,
        amount: u64,
    ) -> Result<()> {
        validate_execution_policy(guard, agent, now, action, amount, 1_000).map(|_| ())
    }

    fn position(collateral: u64, debt: u64) -> crate::adapter::PositionState {
        crate::adapter::PositionState {
            owner: Pubkey::new_unique(),
            lending_market: Pubkey::new_unique(),
            collateral_value_sf: u128::from(collateral) << crate::math::FRACTIONAL_BITS,
            debt_value_sf: u128::from(debt) << crate::math::FRACTIONAL_BITS,
            debt_borrowed_amount_sf: 100_u128 << crate::math::FRACTIONAL_BITS,
            debt_adjusted_market_value_sf: 100_u128 << crate::math::FRACTIONAL_BITS,
            liquidation_ltv_bps: 9_000,
            deposit_reserves: [Pubkey::default(); 8],
            deposit_reserve_count: 0,
            last_update_slot: 10,
            stale: false,
            price_status: 0b0011_1111,
        }
    }

    #[test]
    fn valid_execution_policy_is_accepted() {
        let agent = Pubkey::new_unique();
        assert!(validate(&guard(agent), agent, 1_000, ACTION_REPAY, 500).is_ok());
    }

    #[test]
    fn agent_mismatch_rejected() {
        let agent = Pubkey::new_unique();
        assert!(validate(
            &guard(agent),
            Pubkey::new_unique(),
            1_000,
            ACTION_REPAY,
            500
        )
        .is_err());
    }

    #[test]
    fn paused_rejected() {
        let agent = Pubkey::new_unique();
        let mut config = guard(agent);
        config.paused = true;
        assert!(validate(&config, agent, 1_000, ACTION_REPAY, 500).is_err());
    }

    #[test]
    fn expired_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        assert!(validate(&config, agent, config.expires_at, ACTION_REPAY, 500).is_err());
    }

    #[test]
    fn cooldown_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        assert!(validate(&config, agent, 929, ACTION_REPAY, 500).is_err());
    }

    #[test]
    fn window_limit_rejected() {
        let agent = Pubkey::new_unique();
        let mut config = guard(agent);
        config.actions_in_window = config.max_actions_per_window;
        assert!(validate(&config, agent, 1_000, ACTION_REPAY, 500).is_err());
    }

    #[test]
    fn disallowed_action_rejected() {
        let agent = Pubkey::new_unique();
        assert!(validate(
            &guard(agent),
            agent,
            1_000,
            crate::state::ACTION_TOP_UP,
            500
        )
        .is_err());
    }

    #[test]
    fn amount_over_limit_rejected() {
        let agent = Pubkey::new_unique();
        assert!(validate(&guard(agent), agent, 1_000, ACTION_REPAY, 1_001).is_err());
    }

    #[test]
    fn amount_over_vault_rejected() {
        let agent = Pubkey::new_unique();
        assert!(
            validate_execution_policy(&guard(agent), agent, 1_000, ACTION_REPAY, 501, 500).is_err()
        );
    }

    /// An un-refreshed obligation carries a sentinel liquidation LTV (255 on mainnet
    /// today, which this adapter would read as 25500 bps). Accepting it would make
    /// the "trigger below liquidation threshold" check pass vacuously.
    #[test]
    fn unrefreshed_liquidation_threshold_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        let mut position = position(100, 85);
        position.liquidation_ltv_bps = 255 * 100;
        assert!(validate_pre_cpi_health(&config, &position, 1).is_err());

        position.liquidation_ltv_bps = 0;
        assert!(validate_pre_cpi_health(&config, &position, 1).is_err());

        // A refreshed obligation at the very top of the range is still fine.
        position.liquidation_ltv_bps = crate::math::BPS as u16;
        assert!(position.checked_liquidation_ltv_bps().is_ok());
    }

    #[test]
    fn ltv_below_trigger_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        assert!(validate_pre_cpi_health(&config, &position(1_000, 700), 10).is_err());
    }

    #[test]
    fn overcorrection_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        assert!(validate_pre_cpi_health(&config, &position(100, 80), 11).is_err());
    }

    /// Regression, found by `repay_never_increases_ltv`.
    ///
    /// An underwater position reads as 10000 bps before and after any repay, because
    /// `ltv_bps` clamps. The improvement check must therefore run on the exact debt
    /// value, or the guard is bricked exactly when the position is worst.
    #[test]
    fn underwater_position_can_still_be_repaid() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        let scale = crate::math::FRACTIONAL_BITS;

        // 400% LTV: $1 of collateral against $4 of risk-adjusted debt.
        let before = crate::adapter::PositionState {
            collateral_value_sf: 1_u128 << scale,
            debt_value_sf: 4_u128 << scale,
            debt_borrowed_amount_sf: 4_u128 << scale,
            debt_adjusted_market_value_sf: 4_u128 << scale,
            ..position(1, 4)
        };
        let after = crate::adapter::PositionState {
            debt_borrowed_amount_sf: 3_u128 << scale,
            debt_adjusted_market_value_sf: 3_u128 << scale,
            ..before
        };

        let ltv_before = validate_pre_cpi_health(&config, &before, 1).unwrap();
        assert_eq!(ltv_before, crate::math::BPS as u16, "clamped, as expected");

        let ltv_after = validate_post_cpi_health(&config, &before, &after, ltv_before)
            .expect("a real reduction in debt must be accepted");
        assert_eq!(ltv_after, crate::math::BPS as u16);
    }

    #[test]
    fn no_improvement_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        let before = position(100, 80);
        assert!(validate_post_cpi_health(&config, &before, &before, 8_000).is_err());
    }

    #[test]
    fn durable_nonce_replay_rechecks_live_trigger() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        // A transaction may have been signed while unhealthy, but current
        // account data is healthy at execution time and must fail closed.
        assert!(validate_pre_cpi_health(&config, &position(1_000, 799), 10).is_err());
    }

    /// Models what KLend does to the obligation on a successful repay: the borrow
    /// principal falls by the repaid amount and its risk-adjusted market value falls
    /// in proportion, while the aggregate debt value stays stale until the next
    /// refresh. That staleness is deliberate and is why the guard derives the new LTV
    /// from the borrow entry rather than reading the aggregate.
    fn after_repay(before: &crate::adapter::PositionState, amount: u64) -> crate::adapter::PositionState {
        let repaid_sf = u128::from(amount) << crate::math::FRACTIONAL_BITS;
        let remaining = before.debt_borrowed_amount_sf.saturating_sub(repaid_sf);
        let adjusted = if before.debt_borrowed_amount_sf == 0 {
            0
        } else {
            crate::math::adjusted_value_for_borrow_reduction(
                before.debt_borrowed_amount_sf,
                before.debt_adjusted_market_value_sf,
                remaining,
            )
            .unwrap_or(0)
        };
        crate::adapter::PositionState {
            debt_borrowed_amount_sf: remaining,
            debt_adjusted_market_value_sf: adjusted,
            ..*before
        }
    }

    proptest::proptest! {
        /// ТЗ §10: `execute_action` must never increase LTV.
        ///
        /// The property is two-sided on purpose. Safety: whenever both gates pass,
        /// the position strictly improved. Liveness: whenever the pre-CPI gate passed
        /// and the protocol then behaved correctly, the post-CPI gate must accept —
        /// a guard that rejected honest repays would be just as broken, and only a
        /// randomised search over the (collateral, debt, amount) space finds the
        /// rounding corners where that happens.
        #[test]
        fn repay_never_increases_ltv(
            collateral in 1_u64..=1_000_000,
            debt in 1_u64..=1_000_000,
            borrowed in 1_u64..=1_000_000,
            amount in 1_u64..=1_000_000,
        ) {
            let agent = Pubkey::new_unique();
            let config = guard(agent);

            let scale = crate::math::FRACTIONAL_BITS;
            let before = crate::adapter::PositionState {
                collateral_value_sf: u128::from(collateral) << scale,
                debt_value_sf: u128::from(debt) << scale,
                debt_borrowed_amount_sf: u128::from(borrowed) << scale,
                debt_adjusted_market_value_sf: u128::from(debt) << scale,
                ..position(collateral, debt)
            };

            let Ok(ltv_before) = validate_pre_cpi_health(&config, &before, amount) else {
                return Ok(());
            };

            let after = after_repay(&before, amount);

            // Safety and liveness together: the honest outcome must be accepted, and
            // what it is accepted as must be an improvement.
            let ltv_after = validate_post_cpi_health(&config, &before, &after, ltv_before)
                .map_err(|error| TestCaseError::fail(format!(
                    "an honest repay of {amount} against collateral {collateral}, \
                     debt {debt}, borrow {borrowed} was rejected: {error:?}"
                )))?;

            // Never worse. Not *strictly* better, because `ltv_bps` clamps to BPS:
            // an underwater position reads 10000 on both sides even though the debt
            // genuinely fell. The strict improvement is asserted below, on the exact
            // values, which is where it is actually true.
            prop_assert!(ltv_after <= ltv_before);
            prop_assert!(ltv_after >= config.target_ltv_bps);
            prop_assert!(after.debt_borrowed_amount_sf < before.debt_borrowed_amount_sf);
            prop_assert_eq!(after.collateral_value_sf, before.collateral_value_sf);
        }
    }

    #[test]
    fn current_slot_before_refresh_slot_is_rejected() {
        assert!(validate_freshness(9, 10, false, 0b0011_1111).is_err());
    }

    #[test]
    fn stale_obligation_is_rejected() {
        assert!(validate_freshness(10, 10, true, 0b0011_1111).is_err());
    }

    #[test]
    fn incomplete_oracle_checks_are_rejected() {
        assert!(validate_freshness(10, 10, false, 0b0010_0011).is_err());
    }
}
