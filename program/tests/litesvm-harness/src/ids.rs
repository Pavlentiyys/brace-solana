//! Addresses, seeds and error codes, restated independently of the program crate.
//!
//! Restating rather than importing is deliberate. A test that derives its
//! expectations from the same constants the program uses will keep passing when
//! those constants change, which is exactly when it should fail.

use solana_pubkey::Pubkey;

/// Matches `declare_id!` in `programs/guard/src/lib.rs`.
///
/// Renewed when the program was deployed to devnet. Until then this was Anchor's
/// placeholder, and the whole suite failed with Anchor's 4100
/// (`DeclaredProgramIdMismatch`) rather than reaching any guard logic — which is
/// what the restating above is for.
pub const GUARD_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("CCSVvtVuDpH1wCCQWExCpdmZ1sqUBabJA1QQGai7aVaY");
pub const KLEND_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const FARMS_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
pub const SPL_TOKEN_ID: Pubkey =
    Pubkey::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const INSTRUCTIONS_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("Sysvar1nstructions1111111111111111111111111");

pub const SEED_GUARD: &[u8] = b"guard";
pub const SEED_VAULT: &[u8] = b"vault";
pub const LENDING_MARKET_AUTH_SEED: &[u8] = b"lma";

pub const ACTION_REPAY: u8 = 1 << 0;
pub const ACTION_TOP_UP: u8 = 1 << 1;

/// Anchor instruction discriminators, copied from `idl/guard.json`.
pub mod ix {
    pub const EXECUTE_ACTION: [u8; 8] = [246, 137, 105, 113, 247, 6, 223, 174];
    pub const WITHDRAW_RESERVE: [u8; 8] = [165, 158, 228, 5, 114, 119, 194, 14];
    pub const REVOKE: [u8; 8] = [170, 23, 31, 34, 133, 173, 93, 242];
}

/// `GuardError` variants as Anchor emits them: custom codes start at 6000 and follow
/// declaration order in `errors.rs`.
pub mod err {
    pub const UNAUTHORIZED_AGENT: u32 = 6000;
    pub const GUARD_PAUSED: u32 = 6001;
    pub const GUARD_EXPIRED: u32 = 6002;
    pub const COOLDOWN_ACTIVE: u32 = 6003;
    pub const RATE_LIMIT_EXCEEDED: u32 = 6004;
    pub const ACTION_NOT_ALLOWED: u32 = 6005;
    pub const AMOUNT_EXCEEDS_LIMIT: u32 = 6006;
    pub const STALE_OBLIGATION: u32 = 6007;
    pub const STALE_ORACLE: u32 = 6008;
    pub const TRIGGER_NOT_MET: u32 = 6009;
    pub const ACTION_WOULD_NOT_IMPROVE: u32 = 6010;
    pub const OVERCORRECTION: u32 = 6011;
    pub const INVALID_POLICY: u32 = 6012;
    pub const MATH_OVERFLOW: u32 = 6013;
    pub const UNEXPECTED_PROGRAM: u32 = 6014;
    pub const INVALID_EXTERNAL_ACCOUNT: u32 = 6015;
    pub const INVALID_MARKET_RELATIONSHIP: u32 = 6016;
    pub const MISSING_DEBT_POSITION: u32 = 6017;
    pub const INVALID_REMAINING_ACCOUNTS: u32 = 6018;
    pub const INVALID_AMOUNT: u32 = 6019;
    pub const CLOCK_MOVED_BACKWARDS: u32 = 6020;
    pub const POST_CPI_INVARIANT: u32 = 6021;
}
