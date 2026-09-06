use anchor_lang::{prelude::*, solana_program::sysvar::instructions as instructions_sysvar};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    adapter::{kamino::Kamino, MarketAdapter, RepayAccounts},
    errors::GuardError,
    events::ActionExecuted,
    instructions::repay_health::{
        validate_freshness, validate_post_cpi_health, validate_pre_cpi_health, RepayMode,
    },
    state::{
        GuardConfig, WindowState, ACTION_REPAY, ACTION_SCHEDULED_REPAY, FARMS_PROGRAM_ID,
        KLEND_PROGRAM_ID, LENDING_MARKET_AUTH_SEED, SEED_GUARD, SEED_VAULT,
    },
};

/// What the agent was allowed to do, decided before anything is read from Kamino.
///
/// Carrying the window forward rather than recomputing it after the CPI keeps the
/// accounting on the same view of the clock the permission was granted against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Authorization {
    /// The LTV rule fired. Spends a slot in the action window.
    Emergency(WindowState),
    /// The schedule came due. Bounded by its own interval and nothing else.
    Scheduled,
}

impl Authorization {
    fn mode(self) -> RepayMode {
        match self {
            Authorization::Emergency(_) => RepayMode::Trigger,
            Authorization::Scheduled => RepayMode::Planned,
        }
    }
}

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

    let authorization = validate_execution_policy(
        guard,
        ctx.accounts.agent.key(),
        clock.unix_timestamp,
        action_kind,
        amount,
        ctx.accounts.vault.amount,
    )?;
    let mode = authorization.mode();

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

    let ltv_before = validate_pre_cpi_health(guard, &position_before, amount, mode)?;

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
    // Measured against the cap of the grant that authorized this call, not against
    // whichever cap is larger. The schedule's cap is the smaller of the two by
    // design, and letting a scheduled repay settle under the emergency cap would
    // hand it the emergency's spending power.
    let spend_cap = match authorization {
        Authorization::Emergency(_) => guard.max_action_amount,
        Authorization::Scheduled => guard.schedule_amount,
    };
    require!(
        repaid_amount > 0 && repaid_amount <= spend_cap,
        GuardError::PostCpiInvariant
    );

    let position_after = Kamino::read_position_after_repay(
        &ctx.accounts.obligation.to_account_info(),
        &ctx.accounts.debt_reserve.key(),
    )?;
    let ltv_after =
        validate_post_cpi_health(guard, &position_before, &position_after, ltv_before, mode)?;

    let guard = &mut ctx.accounts.guard;
    match authorization {
        Authorization::Emergency(window) => {
            guard.record_action(clock.unix_timestamp, window, repaid_amount)?
        }
        Authorization::Scheduled => {
            guard.record_scheduled_action(clock.unix_timestamp, repaid_amount)?
        }
    }

    emit!(ActionExecuted {
        guard: guard.key(),
        agent: ctx.accounts.agent.key(),
        obligation: guard.obligation,
        requested_amount: amount,
        repaid_amount,
        ltv_before_bps: ltv_before,
        ltv_after_bps: ltv_after,
        slot: clock.slot,
        action_kind,
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

/// Which grant, if any, permits this call right now.
///
/// The two paths share the agent key, the pause and the expiry, and nothing else.
/// An emergency repay is bounded by a cooldown and an action window; a scheduled one
/// is bounded by its interval. Keeping the budgets apart is the point: a weekly
/// payment that consumed a rate-limit slot could leave the guard unable to act on
/// the crash it exists for.
fn validate_execution_policy(
    guard: &GuardConfig,
    agent: Pubkey,
    now: i64,
    action_kind: u8,
    amount: u64,
    vault_amount: u64,
) -> Result<Authorization> {
    require_keys_eq!(agent, guard.agent, GuardError::UnauthorizedAgent);
    require!(!guard.paused, GuardError::GuardPaused);
    require!(now < guard.expires_at, GuardError::GuardExpired);
    require!(amount > 0, GuardError::InvalidAmount);
    require!(
        action_kind == ACTION_REPAY || action_kind == ACTION_SCHEDULED_REPAY,
        GuardError::ActionNotAllowed
    );
    require!(
        action_kind & guard.allowed_actions != 0,
        GuardError::ActionNotAllowed
    );

    if action_kind == ACTION_SCHEDULED_REPAY {
        require!(
            guard.schedule_seconds > 0,
            GuardError::ScheduleNotConfigured
        );
        require!(guard.schedule_due(now)?, GuardError::ScheduleNotDue);
        require!(
            amount <= guard.schedule_amount && amount <= vault_amount,
            GuardError::AmountExceedsLimit
        );
        return Ok(Authorization::Scheduled);
    }

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
        amount <= guard.max_action_amount && amount <= vault_amount,
        GuardError::AmountExceedsLimit
    );
    Ok(Authorization::Emergency(next_window))
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
            schedule_seconds: 0,
            schedule_amount: 0,
            expires_at: 2_000,
            paused: false,
            last_action_at: 900,
            window_started_at: 500,
            actions_in_window: 0,
            last_scheduled_at: 0,
            total_actions: 1,
            total_repaid: 0,
            bump: 1,
            vault_bump: 1,
        }
    }

    /// The same guard with a weekly schedule armed, last run at t=0.
    fn scheduled_guard(agent: Pubkey) -> GuardConfig {
        GuardConfig {
            allowed_actions: ACTION_REPAY | ACTION_SCHEDULED_REPAY,
            schedule_seconds: 7 * 24 * 60 * 60,
            schedule_amount: 200,
            expires_at: i64::MAX,
            ..guard(agent)
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
    fn scheduled_repay_rejected_without_the_grant() {
        let agent = Pubkey::new_unique();
        // The plain guard permits ACTION_REPAY only.
        assert!(validate(&guard(agent), agent, 1_000, ACTION_SCHEDULED_REPAY, 100).is_err());
    }

    #[test]
    fn scheduled_repay_rejected_before_the_interval() {
        let agent = Pubkey::new_unique();
        let config = scheduled_guard(agent);
        assert!(validate(&config, agent, 100_000, ACTION_SCHEDULED_REPAY, 100).is_err());
        assert!(validate(&config, agent, 604_800, ACTION_SCHEDULED_REPAY, 100).is_ok());
    }

    #[test]
    fn scheduled_repay_is_capped_by_the_schedule_amount() {
        let agent = Pubkey::new_unique();
        let config = scheduled_guard(agent);
        assert!(validate(&config, agent, 604_800, ACTION_SCHEDULED_REPAY, 200).is_ok());
        assert!(validate(&config, agent, 604_800, ACTION_SCHEDULED_REPAY, 201).is_err());
    }

    /// The emergency cap is the larger of the two. A scheduled repay must not be
    /// able to reach it just because the same guard grants both.
    #[test]
    fn scheduled_repay_cannot_borrow_the_emergency_cap() {
        let agent = Pubkey::new_unique();
        let config = scheduled_guard(agent);
        assert_eq!(config.max_action_amount, 1_000);
        assert!(validate(&config, agent, 604_800, ACTION_SCHEDULED_REPAY, 900).is_err());
        assert!(validate(&config, agent, 604_800, ACTION_REPAY, 900).is_ok());
    }

    /// The two budgets are independent in both directions: an exhausted emergency
    /// window must not stop the weekly payment, and a cooldown must not either.
    #[test]
    fn a_spent_emergency_budget_does_not_block_the_schedule() {
        let agent = Pubkey::new_unique();
        let mut config = scheduled_guard(agent);
        config.actions_in_window = config.max_actions_per_window;
        config.window_started_at = 604_000;
        config.last_action_at = 604_790;

        assert!(validate(&config, agent, 604_800, ACTION_REPAY, 100).is_err());
        assert!(validate(&config, agent, 604_800, ACTION_SCHEDULED_REPAY, 100).is_ok());
    }

    #[test]
    fn scheduled_repay_still_needs_the_agent_and_an_unpaused_guard() {
        let agent = Pubkey::new_unique();
        let config = scheduled_guard(agent);
        assert!(validate(
            &config,
            Pubkey::new_unique(),
            604_800,
            ACTION_SCHEDULED_REPAY,
            100
        )
        .is_err());

        let mut paused = scheduled_guard(agent);
        paused.paused = true;
        assert!(validate(&paused, agent, 604_800, ACTION_SCHEDULED_REPAY, 100).is_err());

        let mut expired = scheduled_guard(agent);
        expired.expires_at = 604_800;
        assert!(validate(&expired, agent, 604_800, ACTION_SCHEDULED_REPAY, 100).is_err());
    }

    /// The point of the whole grant: a healthy position, which the trigger path
    /// refuses to touch, is exactly what a planned repay is for.
    #[test]
    fn a_planned_repay_may_pay_down_a_healthy_position() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        let healthy = position(1_000, 700);

        assert!(validate_pre_cpi_health(&config, &healthy, 10, RepayMode::Trigger).is_err());
        assert!(validate_pre_cpi_health(&config, &healthy, 10, RepayMode::Planned).is_ok());
    }

    /// And it may take the position below the target, which for the trigger path is
    /// an overcorrection and here is the intended result.
    #[test]
    fn a_planned_repay_may_go_past_the_target() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        let scale = crate::math::FRACTIONAL_BITS;

        let before = crate::adapter::PositionState {
            collateral_value_sf: 1_000_u128 << scale,
            debt_value_sf: 800_u128 << scale,
            debt_borrowed_amount_sf: 800_u128 << scale,
            debt_adjusted_market_value_sf: 800_u128 << scale,
            ..position(1_000, 800)
        };
        let after = crate::adapter::PositionState {
            debt_borrowed_amount_sf: 400_u128 << scale,
            debt_adjusted_market_value_sf: 400_u128 << scale,
            ..before
        };

        assert!(
            validate_post_cpi_health(&config, &before, &after, 8_000, RepayMode::Trigger).is_err()
        );
        let ltv_after =
            validate_post_cpi_health(&config, &before, &after, 8_000, RepayMode::Planned).unwrap();
        assert_eq!(ltv_after, 4_000);
        assert!(ltv_after < config.target_ltv_bps);
    }

    /// Relaxing the LTV window does not relax the invariants. A repay that leaves
    /// the position no better off is still refused, in both modes.
    #[test]
    fn a_planned_repay_still_has_to_improve_the_position() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        let before = position(100, 80);
        assert!(
            validate_post_cpi_health(&config, &before, &before, 8_000, RepayMode::Planned).is_err()
        );
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
        assert!(validate_pre_cpi_health(&config, &position, 1, RepayMode::Trigger).is_err());

        position.liquidation_ltv_bps = 0;
        assert!(validate_pre_cpi_health(&config, &position, 1, RepayMode::Trigger).is_err());

        // A refreshed obligation at the very top of the range is still fine.
        position.liquidation_ltv_bps = crate::math::BPS as u16;
        assert!(position.checked_liquidation_ltv_bps().is_ok());
    }

    #[test]
    fn ltv_below_trigger_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        assert!(validate_pre_cpi_health(&config, &position(1_000, 700), 10, RepayMode::Trigger).is_err());
    }

    #[test]
    fn overcorrection_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        assert!(validate_pre_cpi_health(&config, &position(100, 80), 11, RepayMode::Trigger).is_err());
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

        let ltv_before = validate_pre_cpi_health(&config, &before, 1, RepayMode::Trigger).unwrap();
        assert_eq!(ltv_before, crate::math::BPS as u16, "clamped, as expected");

        let ltv_after = validate_post_cpi_health(&config, &before, &after, ltv_before, RepayMode::Trigger)
            .expect("a real reduction in debt must be accepted");
        assert_eq!(ltv_after, crate::math::BPS as u16);
    }

    #[test]
    fn no_improvement_rejected() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        let before = position(100, 80);
        assert!(validate_post_cpi_health(&config, &before, &before, 8_000, RepayMode::Trigger).is_err());
    }

    #[test]
    fn durable_nonce_replay_rechecks_live_trigger() {
        let agent = Pubkey::new_unique();
        let config = guard(agent);
        // A transaction may have been signed while unhealthy, but current
        // account data is healthy at execution time and must fail closed.
        assert!(validate_pre_cpi_health(&config, &position(1_000, 799), 10, RepayMode::Trigger).is_err());
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

            let Ok(ltv_before) = validate_pre_cpi_health(&config, &before, amount, RepayMode::Trigger) else {
                return Ok(());
            };

            let after = after_repay(&before, amount);

            // Safety and liveness together: the honest outcome must be accepted, and
            // what it is accepted as must be an improvement.
            let ltv_after = validate_post_cpi_health(&config, &before, &after, ltv_before, RepayMode::Trigger)
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
