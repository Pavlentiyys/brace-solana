use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    errors::GuardError,
    events::ReserveWithdrawn,
    state::{GuardConfig, SEED_GUARD, SEED_VAULT},
};

#[derive(Accounts)]
pub struct WithdrawReserve<'info> {
    #[account(
        seeds = [SEED_GUARD, guard.owner.as_ref(), guard.obligation.as_ref()],
        bump = guard.bump,
        has_one = owner,
        has_one = vault,
        has_one = vault_mint
    )]
    pub guard: Box<Account<'info, GuardConfig>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_VAULT, guard.key().as_ref()],
        bump = guard.vault_bump,
        token::mint = vault_mint,
        token::authority = vault,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = vault_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub owner_destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub vault_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_reserve_handler(
    ctx: Context<WithdrawReserve>,
    requested_amount: u64,
) -> Result<()> {
    let amount = resolve_withdraw_amount(requested_amount, ctx.accounts.vault.amount)?;

    let guard_key = ctx.accounts.guard.key();
    let signer_seeds: &[&[u8]] = &[
        SEED_VAULT,
        guard_key.as_ref(),
        &[ctx.accounts.guard.vault_bump],
    ];
    let accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.vault_mint.to_account_info(),
        to: ctx.accounts.owner_destination.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            accounts,
            &[signer_seeds],
        ),
        amount,
        ctx.accounts.vault_mint.decimals,
    )?;

    emit!(ReserveWithdrawn {
        guard: ctx.accounts.guard.key(),
        owner: ctx.accounts.owner.key(),
        amount,
    });
    Ok(())
}

/// Deliberately depends only on the requested amount and current vault balance.
/// Pause, expiry and revocation are execution restrictions, never exit locks.
fn resolve_withdraw_amount(requested_amount: u64, vault_amount: u64) -> Result<u64> {
    let amount = if requested_amount == u64::MAX {
        vault_amount
    } else {
        requested_amount
    };
    require!(amount > 0, GuardError::InvalidAmount);
    require!(amount <= vault_amount, GuardError::AmountExceedsLimit);
    Ok(amount)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn withdraw_works_when_revoked() {
        assert_eq!(resolve_withdraw_amount(u64::MAX, 500).unwrap(), 500);
    }

    #[test]
    fn withdraw_works_when_expired() {
        assert_eq!(resolve_withdraw_amount(250, 500).unwrap(), 250);
    }

    #[test]
    fn withdraw_works_when_paused() {
        assert_eq!(resolve_withdraw_amount(1, 500).unwrap(), 1);
    }
}
