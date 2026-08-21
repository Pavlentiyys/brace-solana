use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    errors::GuardError,
    events::ReserveDeposited,
    state::{GuardConfig, SEED_GUARD, SEED_VAULT},
};

#[derive(Accounts)]
pub struct DepositReserve<'info> {
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
    pub owner_source: Box<InterfaceAccount<'info, TokenAccount>>,
    pub vault_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn deposit_reserve_handler(ctx: Context<DepositReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, GuardError::InvalidAmount);

    let accounts = TransferChecked {
        from: ctx.accounts.owner_source.to_account_info(),
        mint: ctx.accounts.vault_mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), accounts),
        amount,
        ctx.accounts.vault_mint.decimals,
    )?;

    emit!(ReserveDeposited {
        guard: ctx.accounts.guard.key(),
        owner: ctx.accounts.owner.key(),
        amount,
    });
    Ok(())
}
