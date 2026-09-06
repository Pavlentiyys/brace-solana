use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    errors::GuardError,
    state::{GuardConfig, SEED_GUARD},
};

/// Grows a guard written by the previous program to the current layout.
///
/// The repayment schedule added three fields, so an account written before it is
/// twenty bytes short and `Account<GuardConfig>` refuses to deserialize it. That is
/// the correct refusal — reading the old bytes at the new offsets would report
/// somebody else's number as their expiry — but on its own it strands the account:
/// the guard cannot be read, and `init_guard` cannot replace it because the PDA is
/// already occupied. The owner would be locked out of a live authorization over
/// their own position.
///
/// So this exists, and it is the narrowest thing that unsticks it. It moves the
/// existing bytes into their new places, sets the schedule to "off", and starts the
/// schedule clock at now. Nothing about the authorization changes: same agent, same
/// trigger, same target, same expiry, same reserve.
///
/// It runs once. A second call finds an account that is already the current length
/// and fails rather than shifting the bytes twice.

/// `8 + INIT_SPACE` before `schedule_seconds`, `schedule_amount` and
/// `last_scheduled_at` were added.
const PREVIOUS_LEN: usize = 294;
const CURRENT_LEN: usize = 8 + GuardConfig::INIT_SPACE;

/// Where the fields that moved began, in the previous layout: 8 discriminator, 7
/// keys, and the scalars up to and including `allowed_actions`.
const TAIL_START: usize = 254;
const TAIL_LEN: usize = PREVIOUS_LEN - TAIL_START;

#[derive(Accounts)]
pub struct MigrateGuard<'info> {
    /// CHECK: This is the previous layout, which `Account<GuardConfig>` cannot
    /// deserialize by definition. Ownership is constrained here; the discriminator,
    /// the length and the PDA seeds are all checked in the handler before a byte is
    /// written.
    #[account(mut, owner = crate::ID)]
    pub guard: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn migrate_guard_handler(ctx: Context<MigrateGuard>) -> Result<()> {
    let info = ctx.accounts.guard.to_account_info();
    require!(
        info.data_len() == PREVIOUS_LEN,
        GuardError::InvalidExternalAccount
    );

    // Read what has to survive before anything moves, and prove the caller owns it.
    // The owner and obligation are read out of the account and put back through
    // `find_program_address`: an account that is not the PDA those two seeds derive
    // is not this guard, whatever its discriminator says.
    let (owner, obligation, tail) = {
        let data = info.try_borrow_data()?;
        require!(
            data[..8] == GuardConfig::DISCRIMINATOR[..],
            GuardError::InvalidExternalAccount
        );

        let owner = Pubkey::try_from(&data[8..40]).map_err(|_| GuardError::InvalidExternalAccount)?;
        let obligation =
            Pubkey::try_from(&data[72..104]).map_err(|_| GuardError::InvalidExternalAccount)?;
        let mut tail = [0_u8; TAIL_LEN];
        tail.copy_from_slice(&data[TAIL_START..PREVIOUS_LEN]);
        (owner, obligation, tail)
    };

    require_keys_eq!(
        owner,
        ctx.accounts.owner.key(),
        GuardError::UnauthorizedOwner
    );
    let (expected, _) = Pubkey::find_program_address(
        &[SEED_GUARD, owner.as_ref(), obligation.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(expected, info.key(), GuardError::InvalidExternalAccount);

    // Rent for the twenty new bytes, paid by the owner. The account has to be rent
    // exempt at its new size before it is grown, or the runtime unwinds the whole
    // transaction at the end of the instruction.
    let required = Rent::get()?.minimum_balance(CURRENT_LEN);
    let held = info.lamports();
    if held < required {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: info.clone(),
                },
            ),
            required
                .checked_sub(held)
                .ok_or(GuardError::MathOverflow)?,
        )?;
    }

    info.realloc(CURRENT_LEN, true)?;

    let now = Clock::get()?.unix_timestamp;
    let mut data = info.try_borrow_mut_data()?;

    // `schedule_seconds` and `schedule_amount`: off. `realloc(.., true)` zeroed the
    // tail, not this gap, so it is written explicitly.
    data[TAIL_START..TAIL_START + 12].fill(0);

    // `expires_at` through `actions_in_window`, unchanged and shifted right by the
    // twelve bytes above.
    data[266..292].copy_from_slice(&tail[..26]);

    // `last_scheduled_at`, new. Starting it at now rather than at zero matters: a
    // schedule armed later must count its first interval from the moment it was
    // armed, and a zero here would read as thirty-odd years overdue.
    data[292..300].copy_from_slice(&now.to_le_bytes());

    // `total_actions`, `total_repaid` and the two bumps.
    data[300..CURRENT_LEN].copy_from_slice(&tail[26..]);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The layout arithmetic, checked against the two constants it is derived from.
    /// A field added to `GuardConfig` without updating the offsets here would move
    /// `CURRENT_LEN` and leave these ranges pointing at the wrong bytes.
    #[test]
    fn the_moved_ranges_tile_the_account_exactly() {
        assert_eq!(CURRENT_LEN, 314);
        assert_eq!(TAIL_LEN, 40);
        // 12 zeroed + 26 shifted + 8 new + 14 shifted = the whole tail plus the gap.
        assert_eq!(TAIL_START + 12 + 26 + 8 + (TAIL_LEN - 26), CURRENT_LEN);
    }
}
