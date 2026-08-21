//! Hand-packed SPL Token account and mint blobs.
//!
//! Packed by hand rather than through the `spl-token` crate purely to keep this
//! workspace's dependency graph small — the layouts are frozen and trivial.

use solana_pubkey::Pubkey;

pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const MINT_LEN: usize = 82;

const ACCOUNT_STATE_INITIALIZED: u8 = 1;

/// `mint` @0, `owner` @32, `amount` @64, `delegate` COption @72, `state` @108,
/// `is_native` COption @109, `delegated_amount` @121, `close_authority` COption @129.
pub fn token_account(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0_u8; TOKEN_ACCOUNT_LEN];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = ACCOUNT_STATE_INITIALIZED;
    data
}

pub fn token_account_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

/// `mint_authority` COption @0, `supply` @36, `decimals` @44, `is_initialized` @45,
/// `freeze_authority` COption @46.
pub fn mint(decimals: u8, supply: u64) -> Vec<u8> {
    let mut data = vec![0_u8; MINT_LEN];
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    data
}
