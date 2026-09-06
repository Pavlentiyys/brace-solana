use anchor_lang::{prelude::*, solana_program::sysvar::instructions as instructions_sysvar};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    adapter::{kamino::Kamino, MarketAdapter, RepayAccounts},
    errors::GuardError,
    events::OwnerRepaid,
    instructions::repay_health::{
        validate_freshness, validate_post_cpi_health, validate_pre_cpi_health, RepayMode,
    },
    state::{GuardConfig, FARMS_PROGRAM_ID, KLEND_PROGRAM_ID, LENDING_MARKET_AUTH_SEED, SEED_GUARD, SEED_VAULT},
};

/// The owner sending their own reserve at their own debt, right now.
///
/// It carries no policy at all, and that is the correct answer rather than a gap.
/// The owner can already empty this vault with `withdraw_reserve` under any pause,
/// expiry or revocation, so a path that spends it on their own debt hands nobody a
/// power they did not have. What a policy would buy here is a way for the owner to
/// be told no about their own money, which is not a feature.
///
/// The health invariants still hold. `RepayMode::Planned` drops the trigger and the
/// target — a healthy position being paid down is the whole request — but the
/// position must still end with the same collateral and strictly less debt, or the
/// call fails and nothing moved.
#[derive(Accounts)]
pub struct OwnerRepay<'info> {
    #[account(
        mut,
        seeds = [SEED_GUARD, guard.owner.as_ref(), guard.obligation.as_ref()],
        bump = guard.bump,
        has_one = owner @ GuardError::UnauthorizedOwner,
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
    pub owner: Signer<'info>,
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

pub fn owner_repay_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, OwnerRepay<'info>>,
    requested_amount: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let guard = &ctx.accounts.guard;
    let vault_balance_before = ctx.accounts.vault.amount;
    let amount = resolve_repay_amount(requested_amount, vault_balance_before)?;

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

    let ltv_before =
        validate_pre_cpi_health(guard, &position_before, amount, RepayMode::Planned)?;

    let guard_key = guard.key();
    let vault_bump = guard.vault_bump;
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
    // Bounded by what was authorized rather than by a policy number. KLend settles a
    // repay at the outstanding debt, so asking for the whole reserve against a
    // smaller debt spends only the debt and leaves the rest where it was; the delta
    // is what actually left, and it is what gets recorded.
    require!(
        repaid_amount > 0 && repaid_amount <= amount,
        GuardError::PostCpiInvariant
    );

    let position_after = Kamino::read_position_after_repay(
        &ctx.accounts.obligation.to_account_info(),
        &ctx.accounts.debt_reserve.key(),
    )?;
    let ltv_after = validate_post_cpi_health(
        guard,
        &position_before,
        &position_after,
        ltv_before,
        RepayMode::Planned,
    )?;

    let guard = &mut ctx.accounts.guard;
    guard.record_owner_repay(repaid_amount)?;

    emit!(OwnerRepaid {
        guard: guard.key(),
        owner: guard.owner,
        obligation: guard.obligation,
        requested_amount,
        repaid_amount,
        ltv_before_bps: ltv_before,
        ltv_after_bps: ltv_after,
        slot: clock.slot,
    });
    Ok(())
}

/// `u64::MAX` means "all of it", the same sentinel `withdraw_reserve` already uses.
///
/// "All" is the whole reserve rather than the whole debt, because the reserve is the
/// only number this program can bound. KLend caps the settlement at what is
/// outstanding, so an over-funded vault pays the debt off and keeps the difference.
fn resolve_repay_amount(requested_amount: u64, vault_amount: u64) -> Result<u64> {
    let amount = if requested_amount == u64::MAX {
        vault_amount
    } else {
        requested_amount
    };
    require!(amount > 0, GuardError::InvalidAmount);
    require!(amount <= vault_amount, GuardError::AmountExceedsLimit);
    Ok(amount)
}

fn validate_relationships(
    ctx: &Context<'_, '_, '_, '_, OwnerRepay<'_>>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_means_the_whole_reserve() {
        assert_eq!(resolve_repay_amount(u64::MAX, 500).unwrap(), 500);
    }

    #[test]
    fn a_part_is_taken_as_written() {
        assert_eq!(resolve_repay_amount(120, 500).unwrap(), 120);
    }

    #[test]
    fn nothing_is_not_a_repay() {
        assert!(resolve_repay_amount(0, 500).is_err());
    }

    #[test]
    fn more_than_the_reserve_is_rejected() {
        assert!(resolve_repay_amount(501, 500).is_err());
    }

    /// An empty reserve is the one case where "all" resolves to zero, and it has to
    /// fail rather than send a no-op transaction to Kamino.
    #[test]
    fn all_of_an_empty_reserve_is_rejected() {
        assert!(resolve_repay_amount(u64::MAX, 0).is_err());
    }
}
