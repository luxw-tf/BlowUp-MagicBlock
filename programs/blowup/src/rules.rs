//! Pure game rules shared by the instructions. No account access here, so
//! everything is unit-testable with plain `cargo test`.
//!
//! Mirrors `src/game/config.ts` / `src/game/sim.ts` in the client. Time on the
//! rollup is measured in slots and converted with the match's `slot_ms`.

pub const MAX_PLAYERS: usize = 6;
pub const NO_PLAYER: u8 = u8::MAX;

/// Initial fuse range in ms, indexed by survivors remaining.
///
/// Tuned from the PRD §05 table after ~9,000 simulated matches
/// (docs/onchain-tuning.md): shorter early fuses remove ~15 s of dead time per
/// round, and the 3- and 2-player fuses are long enough that the first holder
/// can actually pass (the 1v1 first holder died 72% of the time with 2–4 s).
pub const FUSE_RANGES_MS: [(u64, u64); MAX_PLAYERS + 1] = [
    (0, 0),
    (0, 0),
    (4_000, 7_000),
    (4_000, 7_000),
    (4_000, 8_500),
    (4_500, 10_000),
    (5_000, 11_000),
];
pub const FUSE_MIN_MS: u64 = 1_250;
pub const COMPRESSION_WINDOW_MS: u64 = 30_000;
pub const COMPRESSION_FLOOR_PERMILLE: u64 = 250;
pub const ROUND_DEADLINE_MS: u64 = 45_000;
/// Long enough to stop instant pass-backs (21% of passes came back within 1 s at 350 ms).
pub const TRANSFER_PROTECTION_MS: u64 = 900;
/// Added to each round's opening fuse (still capped by the round deadline), so
/// the first holder has time to reach someone after the intermission.
pub const OPENING_FUSE_BONUS_MS: u64 = 1_500;

/// Positions are fixed-point millimetres. Arena is 36 × 20 units.
pub const ARENA_HALF_W_MM: i32 = 18_000;
pub const ARENA_HALF_D_MM: i32 = 10_000;
pub const PLAYER_RADIUS_MM: i32 = 450;
pub const TAG_RANGE_MM: i64 = 1_500;
pub const THROW_RANGE_MM: i64 = 10_000;
/// Slack for client-reported positions arriving up to a few ticks apart.
pub const RANGE_TOLERANCE_MM: i64 = 600;
/// Fastest legitimate movement: emergency dash (6u / 0.26s ≈ 23 u/s) + slack.
pub const MAX_SPEED_MM_PER_S: i64 = 26_000;
/// Minimum time credited between two inputs, so a burst inside one slot
/// can still move a tick's worth.
pub const MIN_INPUT_WINDOW_MS: i64 = 60;
/// Cap on time credited between inputs (prevents "saving up" movement).
/// 300ms at max speed ≈ 7.8 units: enough for a dash after a brief network
/// stall, far too little to cross the arena. Measured on devnet: a 1s cap let
/// a +15 unit teleport through after an idle period.
pub const MAX_INPUT_WINDOW_MS: i64 = 300;

/// A player must be silent this long before the lobby may hand them to a bot.
pub const TAKEOVER_GRACE_MS: u64 = 5_000;

/// Takeover is allowed once the player has sent no input for the grace
/// period. A player who never sent any input (last_input_slot == 0) counts as
/// disconnected.
pub fn takeover_allowed(slot: u64, last_input_slot: u64, slot_ms: u16) -> bool {
    slots_to_ms(slot.saturating_sub(last_input_slot), slot_ms) >= TAKEOVER_GRACE_MS
}

/// Unbiased-enough mapping of a u32 to [0, n): floor(u * n / 2^32).
pub fn pick_index(u: u32, n: u32) -> u32 {
    ((u as u64 * n as u64) >> 32) as u32
}

pub fn survivors(alive_mask: u8) -> u8 {
    alive_mask.count_ones() as u8
}

/// The k-th alive player index (k < survivors).
pub fn nth_alive(alive_mask: u8, k: u32) -> u8 {
    let mut seen = 0;
    for i in 0..8u8 {
        if alive_mask & (1 << i) != 0 {
            if seen == k {
                return i;
            }
            seen += 1;
        }
    }
    NO_PLAYER
}

/// Fuse range after time compression: max(0.25, 1 − elapsed/45s) × range,
/// each endpoint floored at the 1.25s nominal minimum.
pub fn fuse_range_ms(survivors: u8, elapsed_ms: u64) -> (u64, u64) {
    let (lo, hi) = FUSE_RANGES_MS[(survivors as usize).clamp(2, MAX_PLAYERS)];
    let decay = (elapsed_ms.min(COMPRESSION_WINDOW_MS) * 1_000) / COMPRESSION_WINDOW_MS;
    let f = (1_000 - decay).max(COMPRESSION_FLOOR_PERMILLE);
    ((lo * f / 1_000).max(FUSE_MIN_MS), (hi * f / 1_000).max(FUSE_MIN_MS))
}

/// Draw a fuse length. The hard round deadline overrides the minimum.
pub fn fuse_ms(survivors: u8, elapsed_ms: u64, remaining_round_ms: u64, u: u32) -> u64 {
    let (lo, hi) = fuse_range_ms(survivors, elapsed_ms);
    let d = lo + (((hi - lo) * u as u64) >> 32);
    d.min(remaining_round_ms)
}

/// Passing is locked in the last FUSE_MIN_MS before the round deadline: a pass
/// there would hand the receiver a fuse cut to a fraction of a second.
pub fn pass_locked(slot: u64, round_deadline_slot: u64, slot_ms: u16) -> bool {
    slot + ms_to_slots(FUSE_MIN_MS, slot_ms) >= round_deadline_slot
}

pub fn ms_to_slots(ms: u64, slot_ms: u16) -> u64 {
    let s = slot_ms.max(1) as u64;
    (ms + s - 1) / s
}

pub fn slots_to_ms(slots: u64, slot_ms: u16) -> u64 {
    slots.saturating_mul(slot_ms as u64)
}

pub fn dist_sq_mm(ax: i32, az: i32, bx: i32, bz: i32) -> i64 {
    let dx = (ax - bx) as i64;
    let dz = (az - bz) as i64;
    dx * dx + dz * dz
}

pub fn within_range(ax: i32, az: i32, bx: i32, bz: i32, range_mm: i64) -> bool {
    let r = range_mm + RANGE_TOLERANCE_MM;
    dist_sq_mm(ax, az, bx, bz) <= r * r
}

pub fn in_bounds(x: i32, z: i32) -> bool {
    x.abs() <= ARENA_HALF_W_MM - PLAYER_RADIUS_MM && z.abs() <= ARENA_HALF_D_MM - PLAYER_RADIUS_MM
}

/// Movement plausibility: displacement must be reachable at max speed in the
/// time elapsed since the previous accepted input.
pub fn move_plausible(dx: i64, dz: i64, elapsed_ms: i64) -> bool {
    let window = elapsed_ms.clamp(MIN_INPUT_WINDOW_MS, MAX_INPUT_WINDOW_MS);
    let max = MAX_SPEED_MM_PER_S * window / 1_000;
    dx * dx + dz * dz <= max * max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_match_tuned_table() {
        assert_eq!(fuse_range_ms(6, 0), (5_000, 11_000));
        assert_eq!(fuse_range_ms(5, 0), (4_500, 10_000));
        assert_eq!(fuse_range_ms(4, 0), (4_000, 8_500));
        assert_eq!(fuse_range_ms(3, 0), (4_000, 7_000));
        assert_eq!(fuse_range_ms(2, 0), (4_000, 7_000));
    }

    #[test]
    fn compression_and_floor() {
        // Half way through the 30 s window: factor 0.5.
        assert_eq!(fuse_range_ms(6, 15_000), (2_500, 5_500));
        // Floor 0.25 → [1250, 2750].
        assert_eq!(fuse_range_ms(6, 29_000), (1_250, 2_750));
        assert_eq!(fuse_range_ms(6, 90_000), (1_250, 2_750));
        // Nominal minimum: 1v1 late in the round → [1000, 1750] floored to 1250.
        assert_eq!(fuse_range_ms(2, 40_000), (1_250, 1_750));
    }

    #[test]
    fn passes_lock_in_the_last_fuse_minimum() {
        // 10 ms slots: FUSE_MIN_MS (1.25 s) = 125 slots.
        assert!(!pass_locked(1_000_000, 1_000_126, 10));
        assert!(pass_locked(1_000_000, 1_000_125, 10));
        assert!(pass_locked(1_000_200, 1_000_125, 10)); // past the deadline
    }

    #[test]
    fn fuse_draw_bounds_and_round_cap() {
        assert_eq!(fuse_ms(6, 0, 45_000, 0), 5_000);
        assert!(fuse_ms(6, 0, 45_000, u32::MAX) < 11_000);
        assert!(fuse_ms(6, 0, 45_000, u32::MAX) > 10_990);
        assert_eq!(fuse_ms(6, 0, 500, u32::MAX), 500);
        assert_eq!(fuse_ms(2, 44_900, 100, 0), 100);
    }

    #[test]
    fn holder_pick_is_in_range_and_covers_all() {
        let mask = 0b0011_0101; // players 0, 2, 4, 5
        assert_eq!(survivors(mask), 4);
        let mut seen = [false; 6];
        for k in 0..4u32 {
            let u = ((k as u64 * (1u64 << 32) + (1u64 << 31)) / 4) as u32;
            let idx = nth_alive(mask, pick_index(u, 4));
            assert!(mask & (1 << idx) != 0);
            seen[idx as usize] = true;
        }
        assert_eq!(seen, [true, false, true, false, true, true]);
        assert_eq!(pick_index(u32::MAX, 6), 5);
        assert_eq!(pick_index(0, 6), 0);
    }

    #[test]
    fn takeover_needs_five_silent_seconds() {
        // 10 ms slots: 500 slots = 5 s.
        assert!(!takeover_allowed(1_000_499, 1_000_000, 10));
        assert!(takeover_allowed(1_000_500, 1_000_000, 10));
        assert!(takeover_allowed(1_000_000, 0, 10)); // never sent an input
        assert!(!takeover_allowed(1_000_000, 1_000_000, 10)); // just sent one
    }

    #[test]
    fn slot_conversion_rounds_up() {
        assert_eq!(ms_to_slots(1_000, 50), 20);
        assert_eq!(ms_to_slots(1_001, 50), 21);
        assert_eq!(ms_to_slots(0, 50), 0);
    }

    #[test]
    fn movement_and_ranges() {
        assert!(move_plausible(300, 0, 50)); // a normal 20 Hz step
        assert!(!move_plausible(5_000, 0, 50)); // teleport
        assert!(!move_plausible(30_000, 0, 10_000)); // can't bank time
        assert!(!move_plausible(15_000, 0, 5_000)); // teleport after idling (caught on devnet)
        assert!(move_plausible(6_000, 0, 5_000)); // a full dash after idling is fine
        assert!(within_range(0, 0, 1_500, 0, TAG_RANGE_MM));
        assert!(!within_range(0, 0, 2_500, 0, TAG_RANGE_MM));
        assert!(in_bounds(17_000, -9_000));
        assert!(!in_bounds(17_900, 0));
    }
}
