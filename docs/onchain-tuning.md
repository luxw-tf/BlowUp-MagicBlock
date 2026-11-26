# BlowUp: tuning changes that touch the on-chain rules

> **Status: applied** (all 9 changes, on-chain and client together; devnet program upgraded).
> Two small deviations from the sketches below:
> - #9 uses a new `RoundLocked` error (appended, so existing error codes are unchanged) instead of reusing `FuseExpired`, so the client can say why a pass was refused ("round is ending").
> - The drift guard suggested under **Tests** exists as `src/game/rules-sync.test.ts`: it parses `rules.rs` and fails if any shared constant differs from `src/game/config.ts`.
>
> Original proposal by Eshita follows, unchanged.

These changes come from a mechanics review backed by about 9,000 simulated bot matches run through the real game simulation. Each one changes a rule that lives in **both** places:

- the on-chain program: `programs/blowup/src/rules.rs` and `programs/blowup/src/lib.rs`
- the client's offline simulation and online mirror: `src/game/config.ts` and `src/game/sim.ts`

Change both sides in the same commit, so online and offline keep the same rules. Nothing below has been applied yet; it's all left for you to do.

---

## Why (the measured problems)

1. **The final is decided by the draw, not by play.** In the last 1v1 the player drawn to hold the bomb dies 72 to 77% of the time (fair is 50%). They never manage a pass in 61 to 65% of finals, and the final lasts 4.7 s. With 3 left, the first holder dies 56 to 60% of the time (fair is 33%). The cause is the 1v1 fuse: 2 to 4 s. After the intermission the two players are 8 to 12 units apart, so the holder gets about one throw.
2. **Early rounds have about 15 s of dead time.** With 6 alive the fuse starts at 8 to 15 s while the bomb changes hands every 2.3 s, so nobody is in danger until compression kicks in. Round 1 averages 30 s and round 2 23 s, which is most of a 100 s match.
3. **Ping-pong.** 21 to 22% of passes come straight back to the sender within 1 s, because transfer protection is only 0.35 s. It's harmless (each pass draws a fresh fuse) but reads as noise.
4. **Unfair deaths at the round deadline.** The fuse is capped at the time left before the 45 s round deadline, so a pass in the last moment can kill the receiver 0.3 s after they get it. It affected 1.3% of 6-player rounds.

## The changes

| # | On-chain (`rules.rs` / `lib.rs`) | Client (`src/game/config.ts` / `sim.ts`) | Now | Proposed |
|---|---|---|---|---|
| 1 | `FUSE_RANGES_MS[6]` | `fuseRanges[6]` | 8–15 s | **5–11 s** `(5_000, 11_000)` |
| 2 | `FUSE_RANGES_MS[5]` | `fuseRanges[5]` | 6–12 s | **4.5–10 s** `(4_500, 10_000)` |
| 3 | `FUSE_RANGES_MS[4]` | `fuseRanges[4]` | 4–9 s | **4–8.5 s** `(4_000, 8_500)` |
| 4 | `FUSE_RANGES_MS[3]` | `fuseRanges[3]` | 3–6 s | **4–7 s** `(4_000, 7_000)` |
| 5 | `FUSE_RANGES_MS[2]` | `fuseRanges[2]` | 2–4 s | **4–7 s** `(4_000, 7_000)` |
| 6 | `COMPRESSION_WINDOW_MS` | `compressionWindow` | 45 s | **30 s** `30_000` |
| 7 | new `OPENING_FUSE_BONUS_MS` | new `openingFuseBonus` | none | **+1.5 s on each round's opening fuse** |
| 8 | `TRANSFER_PROTECTION_MS` | `transferProtection` | 0.35 s | **0.9 s** `900` |
| 9 | extra check in `transfer` | extra check in `holderCanAct` | none | **no pass in the last 1.25 s before the round deadline** |

Unchanged: `FUSE_MIN_MS` (1.25 s), `COMPRESSION_FLOOR_PERMILLE` (250), `ROUND_DEADLINE_MS` (45 s).

### Code sketches

**7. Opening-fuse bonus (on-chain).** In `lib.rs`, `arm_fuse` is called twice in the randomness callback: in the `purpose::HOLDER` branch (round start, line ~296) and in the fuse branch after each pass (line ~302). Add the bonus only for the round's opening holder, still capped by the deadline:

```rust
// rules.rs
pub const OPENING_FUSE_BONUS_MS: u64 = 1_500;

// lib.rs
fn arm_fuse(m: &mut MatchState, u: u32, slot: u64, bonus_ms: u64) {
    let elapsed = slots_to_ms(slot.saturating_sub(m.round_start_slot), m.slot_ms);
    let remaining = slots_to_ms(m.round_deadline_slot.saturating_sub(slot), m.slot_ms);
    let d = (fuse_ms(survivors(m.alive_mask), elapsed, remaining, u) + bonus_ms).min(remaining);
    m.fuse_ms = d as u32;
    m.fuse_deadline_slot = (slot + ms_to_slots(d, m.slot_ms)).max(1);
}
// purpose::HOLDER branch:  arm_fuse(m, draw_u32(&randomness, b"holder-fuse"), slot, OPENING_FUSE_BONUS_MS);
// fuse branch after a pass: arm_fuse(m, draw_u32(&randomness, b"fuse"), slot, 0);
```

Client side: in `src/game/sim.ts` `fulfillRandomness`, holder branch, add `CONFIG.openingFuseBonus` (1.5) to the duration from `computeFuse`, capped by the time left before the round deadline.

**9. Lock passes just before the round deadline (on-chain).** In `transfer` (`lib.rs`), next to the existing `FuseExpired` check:

```rust
require!(
    slot + ms_to_slots(FUSE_MIN_MS, m.slot_ms) < m.round_deadline_slot,
    BlowupError::FuseExpired // or a new FuseLocked error
);
```

Client side: in `src/game/sim.ts` `holderCanAct`, return false when `s.roundDeadline - s.time < CONFIG.fuseMinimum`, so the client never sends a pass the chain would reject.

**Tests.** Update `ranges_match_prd_table` and `compression_and_floor` in `rules.rs`. It's also worth adding a client test that asserts `CONFIG.fuseRanges`, `compressionWindow` and `transferProtection` equal the on-chain constants, so the two can't drift apart again.

## Measured effect (rows 1–8, 300 simulated matches, same seeds)

| | Now | With these changes |
|---|---|---|
| Match length (mean, p10–p90) | 101 s (78–122) | **85 s** (72–99) |
| Round length, 6 / 5 / 4 / 3 / 2 alive | 30.7 / 23.4 / 17.2 / 10.0 / 5.0 s | **17.0 / 15.8 / 14.2 / 12.5 / 11.1 s** |
| First holder dies, 6 / 5 / 4 / 3 / 2 alive (fair 17 / 20 / 25 / 33 / 50%) | 22 / 32 / 39 / 56 / **72%** | 18 / 23 / 25 / 37 / **45%** |
| First holder never passes, 1v1 | 61% | **13%** |
| Passes per round, 6 alive / 1v1 | 9.8 / 0.9 | 4.6 / 1.6 |
| Ping-pong (pass back within 1 s) | 21.7% | **0.5%** |
| Deaths within 1 s of receiving | 0.2% | 0.0% |

Tested and rejected: a faster holder (+8% speed) made rounds longer without fixing the final, and one fuse that carries over between passes led to 30% of deaths within 1 s of receiving.

## Already handled on the client (no chain change)

These are being done separately and don't need anything from you:

- slower bot reactions
- bot navigation per layout
- buffering clicks so they aren't silently dropped
- a visible recovery cue after a missed throw
- item fixes (items are offline only)

One note for online play: after every pass the new holder waits a full VRF round trip ("lighting"), and clicks in that window are dropped. The client will now show that state and buffer clicks, but the wait itself comes from the chain.
