use anchor_lang::prelude::*;

#[error_code]
pub enum BlowupError {
    #[msg("Only the match authority may do this")]
    NotAuthority,
    #[msg("Instruction not allowed in the current match phase")]
    WrongPhase,
    #[msg("Invalid player index or slot already taken")]
    BadPlayerIndex,
    #[msg("Invalid configuration value")]
    BadConfig,
    #[msg("Signer is not this player's session key")]
    NotSessionKey,
    #[msg("Session key has expired")]
    SessionExpired,
    #[msg("Session expiry out of range")]
    BadSessionExpiry,
    #[msg("Input sequence number is stale or duplicated")]
    StaleSequence,
    #[msg("Position outside the arena")]
    OutOfBounds,
    #[msg("Movement is not physically possible in the elapsed time")]
    ImpossibleMovement,
    #[msg("Player is eliminated")]
    PlayerEliminated,
    #[msg("Player state does not belong to this match")]
    WrongMatch,
    #[msg("Signer does not hold the bomb")]
    NotHolder,
    #[msg("Fuse is arming; awaiting randomness")]
    FuseArming,
    #[msg("Fuse has expired; expiration takes precedence")]
    FuseExpired,
    #[msg("Fuse has not expired yet")]
    FuseNotExpired,
    #[msg("Target cannot receive the bomb")]
    InvalidTarget,
    #[msg("Target is protected after a transfer")]
    TargetProtected,
    #[msg("Target is out of range")]
    OutOfRange,
    #[msg("No randomness request is pending")]
    NothingPending,
    #[msg("Randomness request is not old enough to retry")]
    RetryTooEarly,
    #[msg("Oracle queue is not a MagicBlock VRF queue")]
    BadOracleQueue,
    #[msg("Player is still sending inputs; takeover not allowed yet")]
    PlayerStillActive,
}
