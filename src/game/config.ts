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
  tagDaze: 0.6, // a tagged player is frozen this long (offline; online the chain doesn't say how the bomb was passed)
  missRecovery: 0.6, // client side in both modes; shorter, and now shown on the HUD
  transferProtection: 0.9, // stops instant pass-backs (was 0.35 s: 21% of passes came straight back)

  // Fuse, indexed by survivors remaining. Tuned from PRD §05 (docs/onchain-tuning.md).
  // MUST match programs/blowup/src/rules.rs: src/game/rules-sync.test.ts checks it.
  fuseRanges: {
    6: [5, 11],
    5: [4.5, 10],
    4: [4, 8.5],
    3: [4, 7],
    2: [4, 7],
  } as Record<number, [number, number]>,
  fuseMinimum: 1.25, // also: no passes in the round's last fuseMinimum seconds
  compressionWindow: 30,
  openingFuseBonus: 1.5, // added to each round's opening fuse, capped by the round deadline
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
  swapRange: 10, // items are offline only
  slowRange: 8,
  slowFactor: 0.35,
  slowDuration: 1.5,
  timeTheftSeconds: 2,
  timeTheftRunnerSeconds: 1.5, // used by anyone but the holder, Time Theft takes time off the fuse instead

  // Weather (arena.ts WEATHER_FX). On: offline/practice matches feel the weather: wind drifts people and bends
  // throws, rain and snow make the deck slippery, snow is slower going. Never applied online (the on-chain program
  // has no weather, so it would desync); there weather is looks only. `?weatherfx=0` turns it off for one match.
  weatherGameplay: true as boolean,
} as const;

export const TICK_DT = 1 / CONFIG.tickRate;
