#![allow(deprecated)]

use anchor_lang::prelude::*;

pub mod adapter;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

pub use instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZpY6W2BeZ7FEfcYkgMQbS");

#[program]
pub mod guard {
    use super::*;

    pub fn init_guard(ctx: Context<InitGuard>, args: InitGuardArgs) -> Result<()> {
        init_guard_handler(ctx, args)
    }

    pub fn deposit_reserve(ctx: Context<DepositReserve>, amount: u64) -> Result<()> {
        deposit_reserve_handler(ctx, amount)
    }

    pub fn withdraw_reserve(ctx: Context<WithdrawReserve>, amount: u64) -> Result<()> {
        withdraw_reserve_handler(ctx, amount)
    }

    pub fn update_policy(ctx: Context<UpdatePolicy>, args: UpdatePolicyArgs) -> Result<()> {
        update_policy_handler(ctx, args)
    }

    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        revoke_handler(ctx)
    }

    pub fn execute_action<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteAction<'info>>,
        action_kind: u8,
        amount: u64,
    ) -> Result<()> {
        execute_action_handler(ctx, action_kind, amount)
    }
}
