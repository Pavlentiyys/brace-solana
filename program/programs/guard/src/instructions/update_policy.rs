use anchor_lang::prelude::*;

use crate::{
    adapter::kamino::Kamino,
    errors::GuardError,
    events::PolicyUpdated,
    state::{GuardConfig, PolicyParams, SEED_GUARD},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct UpdatePolicyArgs {
    pub agent: Pubkey,
    pub policy: PolicyParams,
    pub paused: bool,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(
        mut,
        seeds = [SEED_GUARD, guard.owner.as_ref(), guard.obligation.as_ref()],
        bump = guard.bump,
        has_one = owner
    )]
    pub guard: Box<Account<'info, GuardConfig>>,
    pub owner: Signer<'info>,
    /// CHECK: Address comes from guard; the adapter validates owner, discriminator and layout.
    #[account(address = guard.obligation)]
    pub obligation: UncheckedAccount<'info>,
}

pub fn update_policy_handler(ctx: Context<UpdatePolicy>, args: UpdatePolicyArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(args.agent != Pubkey::default(), GuardError::InvalidPolicy);
    args.policy.validate(now)?;
    // The tolerant parser on purpose: a fully repaid borrow is removed from the
    // obligation, and the owner must still be able to re-arm or re-scope the policy
    // after that. Only `execute_action` requires the borrow to exist.
    let position = Kamino::read_position_after_repay(
        &ctx.accounts.obligation.to_account_info(),
        &ctx.accounts.guard.debt_reserve,
    )?;
    require_keys_eq!(
        position.owner,
        ctx.accounts.owner.key(),
        GuardError::InvalidMarketRelationship
    );
    require!(
        args.policy.trigger_ltv_bps < position.checked_liquidation_ltv_bps()?,
        GuardError::InvalidPolicy
    );

    let guard = &mut ctx.accounts.guard;
    guard.agent = args.agent;
    args.policy.apply_to(guard);
    guard.paused = args.paused;
    guard.window_started_at = now;
    guard.actions_in_window = 0;

    emit!(PolicyUpdated {
        guard: guard.key(),
        owner: guard.owner,
        agent: guard.agent,
        trigger_ltv_bps: guard.trigger_ltv_bps,
        target_ltv_bps: guard.target_ltv_bps,
        expires_at: guard.expires_at,
        paused: guard.paused,
    });
    Ok(())
}
