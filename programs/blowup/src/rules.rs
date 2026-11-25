//! Pure game rules shared by the instructions. No account access here, so
//! everything is unit-testable with plain `cargo test`.
//!
//! Mirrors `src/game/config.ts` / `src/game/sim.ts` in the client. Time on the
//! rollup is measured in slots and converted with the match's `slot_ms`.

pub const MAX_PLAYERS: usize = 6;
pub const NO_PLAYER: u8 = u8::MAX;

/// Initial fuse range in ms, indexed by survivors remaining (PRD §05).
pub const FUSE_RANGES_MS: [(u64, u64); MAX_PLAYERS + 1] = [
    (0, 0),
    (0, 0),
    (2_000, 4_000),
    (3_000, 6_000),
    (4_000, 9_000),
    (6_000, 12_000),
    (8_000, 15_000),
];
pub const FUSE_MIN_MS: u64 = 1_250;
pub const COMPRESSION_WINDOW_MS: u64 = 45_000;
pub const COMPRESSION_FLOOR_PERMILLE: u64 = 250;
pub const ROUND_DEADLINE_MS: u64 = 45_000;
pub const TRANSFER_PROTECTION_MS: u64 = 350;

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
pub const MAX_INPUT_WINDOW_MS: i64 = 1_000;

/// Reads the i-th little-endian u32 from a VRF output.
pub fn uniform_u32(randomness: &[u8; 32], i: usize) -> u32 {
    let o = (i * 4) % 32;
    u32::from_le_bytes([randomness[o], randomness[o + 1], randomness[o + 2], randomness[o + 3]])
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
    fn ranges_match_prd_table() {
        assert_eq!(fuse_range_ms(6, 0), (8_000, 15_000));
        assert_eq!(fuse_range_ms(2, 0), (2_000, 4_000));
    }

    #[test]
    fn compression_and_floor() {
        // Half way through the window: factor 0.5.
        assert_eq!(fuse_range_ms(6, 22_500), (4_000, 7_500));
        // Floor 0.25 → [2000, 3750].
        assert_eq!(fuse_range_ms(6, 44_000), (2_000, 3_750));
        assert_eq!(fuse_range_ms(6, 90_000), (2_000, 3_750));
        // Nominal minimum.
        assert_eq!(fuse_range_ms(2, 40_000), (1_250, 1_250));
    }

    #[test]
    fn fuse_draw_bounds_and_round_cap() {
        assert_eq!(fuse_ms(6, 0, 45_000, 0), 8_000);
        assert!(fuse_ms(6, 0, 45_000, u32::MAX) < 15_000);
        assert!(fuse_ms(6, 0, 45_000, u32::MAX) > 14_990);
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
        assert!(within_range(0, 0, 1_500, 0, TAG_RANGE_MM));
        assert!(!within_range(0, 0, 2_500, 0, TAG_RANGE_MM));
        assert!(in_bounds(17_000, -9_000));
        assert!(!in_bounds(17_900, 0));
    }
}
