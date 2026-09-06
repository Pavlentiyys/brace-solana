use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    adapter::{kamino::Kamino, MarketAdapter},
    errors::GuardError,
    events::GuardInitialized,
    state::{GuardConfig, PolicyParams, SEED_GUARD, SEED_VAULT},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InitGuardArgs {
    pub agent: Pubkey,
    pub policy: PolicyParams,
}

#[derive(Accounts)]
pub struct InitGuard<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Stored as the delegated executor; it must sign only execute_action.
    pub agent: UncheckedAccount<'info>,
    /// CHECK: Owner, discriminator and layout are validated by the Kamino adapter.
    pub obligation: UncheckedAccount<'info>,
    /// CHECK: Related to both obligation and reserve by adapter validation.
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: Owner, discriminator and layout are validated by the Kamino adapter.
    pub debt_reserve: UncheckedAccount<'info>,
    pub vault_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = owner,
        space = 8 + GuardConfig::INIT_SPACE,
        seeds = [SEED_GUARD, owner.key().as_ref(), obligation.key().as_ref()],
        bump
    )]
    pub guard: Box<Account<'info, GuardConfig>>,
    #[account(
        init,
        payer = owner,
        seeds = [SEED_VAULT, guard.key().as_ref()],
        bump,
        token::mint = vault_mint,
        token::authority = vault,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn init_guard_handler(ctx: Context<InitGuard>, args: InitGuardArgs) -> Result<()> {
    let clock = Clock::get()?;
    require_keys_eq!(
        args.agent,
        ctx.accounts.agent.key(),
        GuardError::InvalidPolicy
    );
    require!(args.agent != Pubkey::default(), GuardError::InvalidPolicy);
    args.policy.validate(clock.unix_timestamp)?;

    let position = Kamino::read_position(
        &ctx.accounts.obligation.to_account_info(),
        &ctx.accounts.debt_reserve.key(),
    )?;
    let reserve = Kamino::read_reserve(&ctx.accounts.debt_reserve.to_account_info())?;

    require_keys_eq!(
        position.owner,
        ctx.accounts.owner.key(),
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        position.lending_market,
        ctx.accounts.lending_market.key(),
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        reserve.lending_market,
        ctx.accounts.lending_market.key(),
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        reserve.liquidity_mint,
        ctx.accounts.vault_mint.key(),
        GuardError::InvalidMarketRelationship
    );
    require_keys_eq!(
        reserve.token_program,
        ctx.accounts.token_program.key(),
        GuardError::InvalidMarketRelationship
    );
    require!(
        args.policy.trigger_ltv_bps < position.checked_liquidation_ltv_bps()?,
        GuardError::InvalidPolicy
    );

    let guard = &mut ctx.accounts.guard;
    guard.owner = ctx.accounts.owner.key();
    guard.agent = args.agent;
    guard.obligation = ctx.accounts.obligation.key();
    guard.lending_market = ctx.accounts.lending_market.key();
    guard.debt_reserve = ctx.accounts.debt_reserve.key();
    guard.vault = ctx.accounts.vault.key();
    guard.vault_mint = ctx.accounts.vault_mint.key();
    args.policy.apply_to(guard);
    guard.paused = false;
    guard.last_action_at = 0;
    guard.window_started_at = clock.unix_timestamp;
    guard.actions_in_window = 0;
    // Counted from now, so a weekly schedule makes its first payment in a week
    // rather than in the same block the authorization was granted.
    guard.last_scheduled_at = clock.unix_timestamp;
    guard.total_actions = 0;
    guard.total_repaid = 0;
    guard.bump = ctx.bumps.guard;
    guard.vault_bump = ctx.bumps.vault;

    emit!(GuardInitialized {
        guard: guard.key(),
        owner: guard.owner,
        agent: guard.agent,
        obligation: guard.obligation,
        vault: guard.vault,
        expires_at: guard.expires_at,
    });
    Ok(())
}
