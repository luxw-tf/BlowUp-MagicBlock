/**
 * All gameplay tuning lives here. Values are the PRD v0.1 provisional defaults
 * and are expected to change with playtesting.
 */
export const CONFIG = {
  tickRate: 20, // simulation ticks per second (PRD §13)

  // Movement (PRD §03)
  moveSpeed: 6,
  acceleration: 70, // units/s² toward target velocity
  deceleration: 55,
  playerRadius: 0.45,
  dashDistance: 4,
  dashDuration: 0.22,
  dashCooldown: 4,
  /** Fraction of overlap resolved per tick between players (soft, non-blocking). */
  playerSeparation: 0.3,

  // Bomb (PRD §03/§04)
  tagRange: 1.5,
  throwRange: 10,
  throwSpeed: 20,
  bombRadius: 0.25,
  missRecovery: 0.8,
  transferProtection: 0.35,

  // Fuse (PRD §05) — indexed by survivors remaining
  fuseRanges: {
    6: [8, 15],
    5: [6, 12],
    4: [4, 9],
    3: [3, 6],
    2: [2, 4],
  } as Record<number, [number, number]>,
  fuseMinimum: 1.25,
  compressionWindow: 45,
  compressionFloor: 0.25,
  roundHardDeadline: 45,
  closeCallThreshold: 0.6,

  // Flow
  matchCountdown: 3,
  intermission: 2.8, // beat after an elimination before the next holder is drawn: long enough to see the blast and breathe
  randomnessRetryAfter: 2.5,

  // Pickups (PRD §06)
  pickupRadius: 0.65,
  pickupRespawn: 8,
  reflectWindow: 0.75,
  blockWindow: 1.25,
  emergencyDashDistance: 6,
  emergencyDashDuration: 0.26,
  swapRange: 8,
  slowRange: 8,
  slowFactor: 0.35,
  slowDuration: 1.5,
  timeTheftSeconds: 2,

  // Weather (arena.ts WEATHER_FX). On: offline/practice matches feel the weather: wind drifts people and bends
  // throws, rain and snow make the deck slippery, snow is slower going. Never applied online (the on-chain program
  // has no weather, so it would desync); there weather is looks only. `?weatherfx=0` turns it off for one match.
  weatherGameplay: true as boolean,
} as const;

export const TICK_DT = 1 / CONFIG.tickRate;
