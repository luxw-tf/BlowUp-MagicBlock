use anchor_lang::prelude::*;

use crate::rules::MAX_PLAYERS;

pub const MATCH_SEED: &[u8] = b"match";
pub const PLAYER_SEED: &[u8] = b"player";
pub const RESULT_SEED: &[u8] = b"result";

pub mod phase {
    pub const LOBBY: u8 = 0;
    /// Waiting on VRF for the next bomb holder.
    pub const ASSIGNING: u8 = 1;
    pub const ACTIVE: u8 = 2;
    pub const FINISHED: u8 = 3;
}

pub mod purpose {
    pub const NONE: u8 = 0;
    pub const HOLDER: u8 = 1;
    pub const FUSE: u8 = 2;
}

/// Authoritative match state. Delegated to the ER for the whole match.
#[account]
#[derive(InitSpace)]
pub struct MatchState {
    /// Lobby service key: sponsors rent, starts and finalizes matches, cranks eliminations.
    pub authority: Pubkey,
    pub match_id: u64,
    pub phase: u8,
    pub player_count: u8,
    pub alive_mask: u8,
    pub holder: u8,
    pub round: u8,
    /// Nominal ER slot duration used to convert ms ↔ slots.
    pub slot_ms: u16,
    pub round_start_slot: u64,
    pub round_deadline_slot: u64,
    /// 0 while the fuse awaits randomness ("arming").
    pub fuse_deadline_slot: u64,
    pub fuse_ms: u32,
    pub protected_player: u8,
    pub protected_until_slot: u64,
    /// Incremented per randomness request; callbacks carrying an older nonce are ignored.
    pub vrf_nonce: u8,
    pub vrf_purpose: u8,
    pub vrf_requested_slot: u64,
    pub vrf_fulfilled: u32,
    pub last_randomness: [u8; 32],
    pub transfers: u32,
    pub last_giver: u8,
    /// Placement per player index (1 = winner, 0 = undecided).
    pub placements: [u8; MAX_PLAYERS],
    pub winner: u8,
    pub players: [Pubkey; MAX_PLAYERS],
    pub bump: u8,
}

/// Per-player state. Inputs only write this account, so players don't contend
/// on MatchState for movement.
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub match_key: Pubkey,
    pub index: u8,
    /// Guest identity (no wallet). Can renew its own session key.
    pub authority: Pubkey,
    /// Scoped signer for gameplay inputs; valid until `session_expiry`.
    pub session_key: Pubkey,
    pub session_expiry: i64,
    /// Position in millimetres.
    pub x: i32,
    pub z: i32,
    pub seq: u32,
    pub last_input_slot: u64,
    pub inputs_accepted: u32,
    pub bump: u8,
}

/// Durable result on the Solana base layer, written after undelegation.
#[account]
#[derive(InitSpace)]
pub struct MatchResult {
    pub match_key: Pubkey,
    pub match_id: u64,
    pub winner: Pubkey,
    pub players: [Pubkey; MAX_PLAYERS],
    pub placements: [u8; MAX_PLAYERS],
    pub rounds: u8,
    pub transfers: u32,
    pub vrf_fulfilled: u32,
    pub last_randomness: [u8; 32],
    pub recorded_slot: u64,
    pub bump: u8,
}
