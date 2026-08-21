use anchor_lang::prelude::*;

use crate::{
    events::GuardRevoked,
    state::{GuardConfig, SEED_GUARD},
};

#[derive(Accounts)]
pub struct Revoke<'info> {
    #[account(
        mut,
        seeds = [SEED_GUARD, guard.owner.as_ref(), guard.obligation.as_ref()],
        bump = guard.bump,
        has_one = owner
    )]
    pub guard: Box<Account<'info, GuardConfig>>,
    pub owner: Signer<'info>,
}

pub fn revoke_handler(ctx: Context<Revoke>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let guard = &mut ctx.accounts.guard;
    guard.paused = true;
    guard.expires_at = now;
    guard.allowed_actions = 0;

    emit!(GuardRevoked {
        guard: guard.key(),
        owner: guard.owner,
        revoked_at: now,
    });
    Ok(())
}
