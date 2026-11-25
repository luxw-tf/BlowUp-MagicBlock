//! BlowUp match program (PRD Phase 00 feasibility).
//!
//! Lifecycle:
//!   base layer : create_match → join_match ×N → delegate_player ×N → delegate_match
//!   ephemeral  : start_match → [VRF callback] → submit_input / transfer / eliminate … → finalize
//!   base layer : record_result (durable MatchResult)
//!
//! Every decisive random draw (bomb holder, fuse length) comes from MagicBlock
//! VRF via `callback_randomness`. Callbacks are bound to a nonce, so stale or
//! duplicate fulfilments are ignored, and requests can be retried after a
//! bounded wait.
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    anchor::{commit, delegate, ephemeral, vrf, vrf_callback},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::{
        consts::{
            program_identity_pubkey, DEFAULT_EPHEMERAL_QUEUE, DEFAULT_EPHEMERAL_TEST_QUEUE, DEFAULT_QUEUE,
            DEFAULT_TEST_QUEUE,
        },
        instructions::{create_request_randomness_ix_const, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};

pub mod errors;
pub mod rules;
pub mod state;

use errors::BlowupError;
use rules::*;
use state::*;

declare_id!("11111111111111111111111111111111");

/// Scoped VRF requester identity, derived at compile time (SDK 0.18+).
const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);

/// Spawn points in mm, matching `src/game/arena.ts`.
const SPAWNS_MM: [(i32, i32); MAX_PLAYERS] = [
    (-12_000, -6_000),
    (0, -6_500),
    (12_000, -6_000),
    (12_000, 6_000),
    (0, 6_500),
    (-12_000, 6_000),
];

/// Pending randomness may be re-requested after this long.
const RANDOMNESS_RETRY_MS: u64 = 3_000;
/// Longest session a guest key may be granted.
const MAX_SESSION_SECONDS: i64 = 24 * 60 * 60;

fn is_vrf_queue(k: &Pubkey) -> bool {
    *k == DEFAULT_QUEUE || *k == DEFAULT_EPHEMERAL_QUEUE || *k == DEFAULT_TEST_QUEUE || *k == DEFAULT_EPHEMERAL_TEST_QUEUE
}

fn caller_seed(m: &MatchState, client_seed: [u8; 8], slot: u64) -> [u8; 32] {
    let mut s = [0u8; 32];
    s[0..8].copy_from_slice(&m.match_id.to_le_bytes());
    s[8] = m.vrf_nonce;
    s[9] = m.vrf_purpose;
    s[10..18].copy_from_slice(&client_seed);
    s[18..26].copy_from_slice(&slot.to_le_bytes());
    s
}

/// Marks a new pending request on the match and returns its params.
fn begin_request(
    m: &mut MatchState,
    match_key: Pubkey,
    payer: Pubkey,
    oracle_queue: Pubkey,
    purpose_id: u8,
    client_seed: [u8; 8],
    slot: u64,
) -> RequestRandomnessParams {
    m.vrf_nonce = m.vrf_nonce.wrapping_add(1);
    m.vrf_purpose = purpose_id;
    m.vrf_requested_slot = slot;
    RequestRandomnessParams {
        payer,
        oracle_queue,
        callback_program_id: ID,
        callback_discriminator: instruction::CallbackRandomness::DISCRIMINATOR.to_vec(),
        caller_seed: caller_seed(m, client_seed, slot),
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: match_key,
            is_signer: false,
            is_writable: true,
        }]),
        callback_args: Some(vec![purpose_id, m.vrf_nonce]),
        ..Default::default()
    }
}

fn arm_fuse(m: &mut MatchState, u: u32, slot: u64) {
    let elapsed = slots_to_ms(slot.saturating_sub(m.round_start_slot), m.slot_ms);
    let remaining = slots_to_ms(m.round_deadline_slot.saturating_sub(slot), m.slot_ms);
    let d = fuse_ms(survivors(m.alive_mask), elapsed, remaining, u);
    m.fuse_ms = d as u32;
    // Never 0: 0 means "arming". A zero-length fuse (round cap hit) expires immediately.
    m.fuse_deadline_slot = (slot + ms_to_slots(d, m.slot_ms)).max(1);
}

fn check_session(p: &PlayerState, signer: &Pubkey) -> Result<()> {
    require_keys_eq!(*signer, p.session_key, BlowupError::NotSessionKey);
    require!(Clock::get()?.unix_timestamp < p.session_expiry, BlowupError::SessionExpired);
    Ok(())
}

#[ephemeral]
#[program]
pub mod blowup {
    use super::*;

    // ───────────────────────── base layer ─────────────────────────

    pub fn create_match(ctx: Context<CreateMatch>, match_id: u64, slot_ms: u16) -> Result<()> {
        require!((10..=1_000).contains(&slot_ms), BlowupError::BadConfig);
        let m = &mut ctx.accounts.match_state;
        m.authority = ctx.accounts.authority.key();
        m.match_id = match_id;
        m.phase = phase::LOBBY;
        m.player_count = 0;
        m.alive_mask = 0;
        m.holder = NO_PLAYER;
        m.round = 0;
        m.slot_ms = slot_ms;
        m.fuse_deadline_slot = 0;
        m.protected_player = NO_PLAYER;
        m.vrf_purpose = purpose::NONE;
        m.last_giver = NO_PLAYER;
        m.winner = NO_PLAYER;
        m.bump = ctx.bumps.match_state;
        Ok(())
    }

    /// Sponsored join: the lobby authority pays rent; the guest needs no SOL.
    pub fn join_match(
        ctx: Context<JoinMatch>,
        index: u8,
        player: Pubkey,
        session_key: Pubkey,
        session_expiry: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            session_expiry > now && session_expiry <= now + MAX_SESSION_SECONDS,
            BlowupError::BadSessionExpiry
        );
        let m = &mut ctx.accounts.match_state;
        require!(m.phase == phase::LOBBY, BlowupError::WrongPhase);
        let i = index as usize;
        require!(i < MAX_PLAYERS && m.alive_mask & (1 << index) == 0, BlowupError::BadPlayerIndex);
        m.players[i] = player;
        m.alive_mask |= 1 << index;
        m.player_count += 1;

        let p = &mut ctx.accounts.player_state;
        p.match_key = m.key();
        p.index = index;
        p.authority = player;
        p.session_key = session_key;
        p.session_expiry = session_expiry;
        (p.x, p.z) = SPAWNS_MM[i];
        p.seq = 0;
        p.last_input_slot = 0;
        p.inputs_accepted = 0;
        p.bump = ctx.bumps.player_state;
        Ok(())
    }

    /// Delegate a player account. Do this for every player BEFORE delegating the match.
    pub fn delegate_player(ctx: Context<DelegatePlayer>, index: u8) -> Result<()> {
        let match_key = ctx.accounts.match_state.key();
        ctx.accounts.delegate_player_state(
            &ctx.accounts.payer,
            &[PLAYER_SEED, match_key.as_ref(), &[index]],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn delegate_match(ctx: Context<DelegateMatch>, match_id: u64) -> Result<()> {
        {
            let data = ctx.accounts.match_state.try_borrow_data()?;
            let m = MatchState::try_deserialize(&mut &data[..])?;
            require_keys_eq!(m.authority, ctx.accounts.payer.key(), BlowupError::NotAuthority);
            require!(m.phase == phase::LOBBY && m.player_count >= 2, BlowupError::WrongPhase);
        }
        ctx.accounts.delegate_match_state(
            &ctx.accounts.payer,
            &[MATCH_SEED, &match_id.to_le_bytes()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Durable result on Solana after `finalize` committed and undelegated.
    /// `init` makes this naturally idempotent: a second call fails, never overwrites.
    pub fn record_result(ctx: Context<RecordResult>) -> Result<()> {
        let m = &ctx.accounts.match_state;
        require!(m.phase == phase::FINISHED, BlowupError::WrongPhase);
        let r = &mut ctx.accounts.result;
        r.match_key = m.key();
        r.match_id = m.match_id;
        r.winner = if m.winner == NO_PLAYER { Pubkey::default() } else { m.players[m.winner as usize] };
        r.players = m.players;
        r.placements = m.placements;
        r.rounds = m.round;
        r.transfers = m.transfers;
        r.vrf_fulfilled = m.vrf_fulfilled;
        r.last_randomness = m.last_randomness;
        r.recorded_slot = Clock::get()?.slot;
        r.bump = ctx.bumps.result;
        Ok(())
    }

    // ───────────────────────── ephemeral rollup ─────────────────────────

    pub fn start_match(ctx: Context<RequestCtx>, client_seed: [u8; 8]) -> Result<()> {
        require!(is_vrf_queue(&ctx.accounts.oracle_queue.key()), BlowupError::BadOracleQueue);
        let match_key = ctx.accounts.match_state.key();
        let m = &mut ctx.accounts.match_state;
        require_keys_eq!(m.authority, ctx.accounts.payer.key(), BlowupError::NotAuthority);
        require!(m.phase == phase::LOBBY && m.player_count >= 2, BlowupError::WrongPhase);
        m.phase = phase::ASSIGNING;
        let slot = Clock::get()?.slot;
        let params = begin_request(
            m,
            match_key,
            ctx.accounts.payer.key(),
            ctx.accounts.oracle_queue.key(),
            purpose::HOLDER,
            client_seed,
            slot,
        );
        let ix = create_request_randomness_ix_const(params, PROGRAM_IDENTITY);
        ctx.accounts.match_state.exit(&crate::ID)?;
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback. Bound to (purpose, nonce): anything else is a stale or
    /// duplicate fulfilment and is ignored without error.
    pub fn callback_randomness(
        ctx: Context<CallbackRandomnessCtx>,
        randomness: [u8; 32],
        purpose_id: u8,
        nonce: u8,
    ) -> Result<()> {
        let m = &mut ctx.accounts.match_state;
        if purpose_id != m.vrf_purpose || nonce != m.vrf_nonce || purpose_id == purpose::NONE {
            msg!("stale randomness ignored: purpose={} nonce={}", purpose_id, nonce);
            return Ok(());
        }
        let slot = Clock::get()?.slot;
        m.vrf_purpose = purpose::NONE;
        m.vrf_fulfilled += 1;
        m.last_randomness = randomness;

        if purpose_id == purpose::HOLDER {
            if m.phase != phase::ASSIGNING {
                return Ok(());
            }
            let n = survivors(m.alive_mask);
            let holder = nth_alive(m.alive_mask, pick_index(uniform_u32(&randomness, 0), n as u32));
            m.holder = holder;
            m.round = m.player_count - n + 1;
            m.round_start_slot = slot;
            m.round_deadline_slot = slot + ms_to_slots(ROUND_DEADLINE_MS, m.slot_ms);
            m.protected_player = NO_PLAYER;
            m.last_giver = NO_PLAYER;
            m.phase = phase::ACTIVE;
            arm_fuse(m, uniform_u32(&randomness, 1), slot);
            msg!("round {} holder {} fuse {}ms", m.round, holder, m.fuse_ms);
        } else {
            if m.phase != phase::ACTIVE || m.fuse_deadline_slot != 0 {
                return Ok(());
            }
            arm_fuse(m, uniform_u32(&randomness, 0), slot);
            msg!("fuse {}ms for holder {}", m.fuse_ms, m.holder);
        }
        Ok(())
    }

    /// Gameplay input from a player's scoped session key.
    pub fn submit_input(ctx: Context<SubmitInput>, seq: u32, x: i32, z: i32) -> Result<()> {
        let m = &ctx.accounts.match_state;
        let p = &mut ctx.accounts.player_state;
        require_keys_eq!(p.match_key, m.key(), BlowupError::WrongMatch);
        check_session(p, &ctx.accounts.signer.key())?;
        require!(m.phase != phase::FINISHED, BlowupError::WrongPhase);
        require!(m.alive_mask & (1 << p.index) != 0, BlowupError::PlayerEliminated);
        require!(seq > p.seq, BlowupError::StaleSequence);
        require!(in_bounds(x, z), BlowupError::OutOfBounds);
        let slot = Clock::get()?.slot;
        let elapsed_ms = slots_to_ms(slot.saturating_sub(p.last_input_slot), m.slot_ms) as i64;
        require!(
            move_plausible((x - p.x) as i64, (z - p.z) as i64, elapsed_ms),
            BlowupError::ImpossibleMovement
        );
        p.seq = seq;
        p.x = x;
        p.z = z;
        p.last_input_slot = slot;
        p.inputs_accepted += 1;
        Ok(())
    }

    /// Guest identity rotates/renews its own session key (no wallet involved).
    pub fn renew_session(ctx: Context<RenewSession>, session_key: Pubkey, session_expiry: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            session_expiry > now && session_expiry <= now + MAX_SESSION_SECONDS,
            BlowupError::BadSessionExpiry
        );
        let p = &mut ctx.accounts.player_state;
        require_keys_eq!(p.authority, ctx.accounts.authority.key(), BlowupError::NotSessionKey);
        p.session_key = session_key;
        p.session_expiry = session_expiry;
        Ok(())
    }

    /// Bomb transfer. method 0 = tag (1.5u), 1 = throw hit (10u).
    /// Requests a fresh fuse from VRF; the fuse is "arming" until the callback.
    pub fn transfer(ctx: Context<TransferCtx>, target_index: u8, method: u8, client_seed: [u8; 8]) -> Result<()> {
        require!(is_vrf_queue(&ctx.accounts.oracle_queue.key()), BlowupError::BadOracleQueue);
        let slot = Clock::get()?.slot;
        let match_key = ctx.accounts.match_state.key();
        let holder_state = &ctx.accounts.holder_state;
        let target_state = &ctx.accounts.target_state;
        let m = &mut ctx.accounts.match_state;

        require!(m.phase == phase::ACTIVE, BlowupError::WrongPhase);
        require_keys_eq!(holder_state.match_key, match_key, BlowupError::WrongMatch);
        require_keys_eq!(target_state.match_key, match_key, BlowupError::WrongMatch);
        require!(holder_state.index == m.holder, BlowupError::NotHolder);
        check_session(holder_state, &ctx.accounts.payer.key())?;
        require!(m.fuse_deadline_slot != 0, BlowupError::FuseArming);
        // Expiration takes precedence at or after the deadline.
        require!(slot < m.fuse_deadline_slot && slot < m.round_deadline_slot, BlowupError::FuseExpired);
        require!(
            target_state.index == target_index
                && target_index != m.holder
                && m.alive_mask & (1 << target_index) != 0,
            BlowupError::InvalidTarget
        );
        require!(
            !(m.protected_player == target_index && slot < m.protected_until_slot),
            BlowupError::TargetProtected
        );
        let range = if method == 0 { TAG_RANGE_MM } else { THROW_RANGE_MM };
        require!(
            within_range(holder_state.x, holder_state.z, target_state.x, target_state.z, range),
            BlowupError::OutOfRange
        );

        m.last_giver = m.holder;
        m.protected_player = m.holder;
        m.protected_until_slot = slot + ms_to_slots(TRANSFER_PROTECTION_MS, m.slot_ms);
        m.holder = target_index;
        m.fuse_deadline_slot = 0;
        m.transfers += 1;
        let params = begin_request(
            m,
            match_key,
            ctx.accounts.payer.key(),
            ctx.accounts.oracle_queue.key(),
            purpose::FUSE,
            client_seed,
            slot,
        );
        let ix = create_request_randomness_ix_const(params, PROGRAM_IDENTITY);
        ctx.accounts.match_state.exit(&crate::ID)?;
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// Permissionless crank: eliminates the holder once the fuse (or round
    /// deadline) has passed, then draws the next holder via VRF.
    pub fn eliminate(ctx: Context<RequestCtx>, client_seed: [u8; 8]) -> Result<()> {
        require!(is_vrf_queue(&ctx.accounts.oracle_queue.key()), BlowupError::BadOracleQueue);
        let slot = Clock::get()?.slot;
        let match_key = ctx.accounts.match_state.key();
        let m = &mut ctx.accounts.match_state;
        require!(m.phase == phase::ACTIVE && m.holder != NO_PLAYER, BlowupError::WrongPhase);
        let fuse_out = m.fuse_deadline_slot != 0 && slot >= m.fuse_deadline_slot;
        require!(fuse_out || slot >= m.round_deadline_slot, BlowupError::FuseNotExpired);

        let before = survivors(m.alive_mask);
        let out = m.holder;
        m.placements[out as usize] = before;
        m.alive_mask &= !(1 << out);
        m.holder = NO_PLAYER;
        m.fuse_deadline_slot = 0;
        m.protected_player = NO_PLAYER;
        msg!("eliminated {} (placement {})", out, before);

        if before - 1 <= 1 {
            let w = nth_alive(m.alive_mask, 0);
            m.winner = w;
            if w != NO_PLAYER {
                m.placements[w as usize] = 1;
            }
            m.phase = phase::FINISHED;
            m.vrf_purpose = purpose::NONE; // any in-flight callback is now stale
            msg!("winner {}", w);
            return Ok(());
        }

        m.phase = phase::ASSIGNING;
        let params = begin_request(
            m,
            match_key,
            ctx.accounts.payer.key(),
            ctx.accounts.oracle_queue.key(),
            purpose::HOLDER,
            client_seed,
            slot,
        );
        let ix = create_request_randomness_ix_const(params, PROGRAM_IDENTITY);
        ctx.accounts.match_state.exit(&crate::ID)?;
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// Bounded pending state: re-request randomness that hasn't arrived.
    /// The nonce changes, so a late callback for the old request is ignored.
    pub fn retry_randomness(ctx: Context<RequestCtx>, client_seed: [u8; 8]) -> Result<()> {
        require!(is_vrf_queue(&ctx.accounts.oracle_queue.key()), BlowupError::BadOracleQueue);
        let slot = Clock::get()?.slot;
        let match_key = ctx.accounts.match_state.key();
        let m = &mut ctx.accounts.match_state;
        require_keys_eq!(m.authority, ctx.accounts.payer.key(), BlowupError::NotAuthority);
        require!(m.vrf_purpose != purpose::NONE, BlowupError::NothingPending);
        require!(
            slots_to_ms(slot.saturating_sub(m.vrf_requested_slot), m.slot_ms) >= RANDOMNESS_RETRY_MS,
            BlowupError::RetryTooEarly
        );
        let p = m.vrf_purpose;
        let params = begin_request(
            m,
            match_key,
            ctx.accounts.payer.key(),
            ctx.accounts.oracle_queue.key(),
            p,
            client_seed,
            slot,
        );
        let ix = create_request_randomness_ix_const(params, PROGRAM_IDENTITY);
        ctx.accounts.match_state.exit(&crate::ID)?;
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// Terminate without a false winner (ER outage / abandoned match).
    pub fn abort_match(ctx: Context<AuthorityCtx>) -> Result<()> {
        let m = &mut ctx.accounts.match_state;
        require_keys_eq!(m.authority, ctx.accounts.payer.key(), BlowupError::NotAuthority);
        require!(m.phase != phase::FINISHED, BlowupError::WrongPhase);
        m.phase = phase::FINISHED;
        m.winner = NO_PLAYER;
        m.holder = NO_PLAYER;
        m.vrf_purpose = purpose::NONE;
        Ok(())
    }

    /// Commit final state to Solana and undelegate. Remaining accounts: every
    /// PlayerState of this match (writable).
    pub fn finalize<'info>(ctx: Context<'info, Finalize<'info>>) -> Result<()> {
        let m = &ctx.accounts.match_state;
        require_keys_eq!(m.authority, ctx.accounts.payer.key(), BlowupError::NotAuthority);
        require!(m.phase == phase::FINISHED, BlowupError::WrongPhase);
        let mut accounts = vec![ctx.accounts.match_state.to_account_info()];
        for acc in ctx.remaining_accounts.iter() {
            require_keys_eq!(*acc.owner, crate::ID, BlowupError::WrongMatch);
            let p = PlayerState::try_deserialize(&mut &acc.try_borrow_data()?[..])?;
            require_keys_eq!(p.match_key, m.key(), BlowupError::WrongMatch);
            accounts.push(acc.clone());
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&accounts)
        .build_and_invoke()?;
        Ok(())
    }
}

// ───────────────────────── account contexts ─────────────────────────

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct CreateMatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + MatchState::INIT_SPACE,
        seeds = [MATCH_SEED, &match_id.to_le_bytes()],
        bump
    )]
    pub match_state: Account<'info, MatchState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct JoinMatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ BlowupError::NotAuthority)]
    pub match_state: Account<'info, MatchState>,
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_SEED, match_state.key().as_ref(), &[index]],
        bump
    )]
    pub player_state: Account<'info, PlayerState>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(constraint = match_state.authority == payer.key() @ BlowupError::NotAuthority)]
    pub match_state: Account<'info, MatchState>,
    /// CHECK: PDA delegated to the ER; seeds checked here.
    #[account(mut, del, seeds = [PLAYER_SEED, match_state.key().as_ref(), &[index]], bump)]
    pub player_state: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct DelegateMatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA delegated to the ER; authority checked in the handler.
    #[account(mut, del, seeds = [MATCH_SEED, &match_id.to_le_bytes()], bump)]
    pub match_state: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RecordResult<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub match_state: Account<'info, MatchState>,
    #[account(
        init,
        payer = payer,
        space = 8 + MatchResult::INIT_SPACE,
        seeds = [RESULT_SEED, match_state.key().as_ref()],
        bump
    )]
    pub result: Account<'info, MatchResult>,
    pub system_program: Program<'info, System>,
}

/// Shared by start_match / eliminate / retry_randomness.
#[vrf]
#[derive(Accounts)]
pub struct RequestCtx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    /// CHECK: must be a MagicBlock VRF queue; checked in handlers.
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackRandomnessCtx<'info> {
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
}

#[derive(Accounts)]
pub struct SubmitInput<'info> {
    pub signer: Signer<'info>,
    pub match_state: Account<'info, MatchState>,
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[derive(Accounts)]
pub struct RenewSession<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[vrf]
#[derive(Accounts)]
pub struct TransferCtx<'info> {
    /// The holder's session key (also pays the fee-exempt ephemeral VRF request).
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    pub holder_state: Account<'info, PlayerState>,
    pub target_state: Account<'info, PlayerState>,
    /// CHECK: must be a MagicBlock VRF queue; checked in handler.
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AuthorityCtx<'info> {
    pub payer: Signer<'info>,
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
}

#[commit]
#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
}
