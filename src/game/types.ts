export interface Vec2 {
  x: number;
  z: number;
}

export type PlayerId = string;

export type CharacterId = 'frog' | 'cat' | 'blob' | 'rat' | 'duck' | 'creature';

export type AbilityId =
  | 'returnToSender'
  | 'notToday'
  | 'outtaHere'
  | 'plotTwist'
  | 'skillIssue'
  | 'timeTheft';

/** One input frame. Humans and bots submit exactly the same shape. */
export interface InputFrame {
  seq: number;
  move: Vec2; // camera-relative already resolved to world XZ, length <= 1
  aim: Vec2; // world-space aim point on the ground
  throw: boolean;
  tag: boolean;
  dash: boolean;
  use: boolean;
}

export interface PlayerStats {
  tags: number;
  throws: number;
  throwHits: number;
  misses: number;
  reflects: number;
  blocks: number;
  dashes: number;
  pickups: number;
  abilitiesUsed: number;
  timeHolding: number;
  closeCalls: number;
  received: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  character: CharacterId;
  isBot: boolean;
  alive: boolean;
  pos: Vec2;
  vel: Vec2;
  aim: Vec2;
  dashUntil: number;
  dashDir: Vec2;
  dashSpeed: number;
  dashReadyAt: number;
  slowUntil: number;
  recoverUntil: number;
  /** 'pending' = box collected, reward awaiting randomness. */
  inventory: AbilityId | 'pending' | null;
  shield: 'reflect' | 'block' | null;
  shieldUntil: number;
  lastSeq: number;
  eliminatedAt: number | null;
  placement: number | null;
  stats: PlayerStats;
}

export interface Projectile {
  ownerId: PlayerId;
  pos: Vec2;
  dir: Vec2;
  traveled: number;
}

export interface BombState {
  holderId: PlayerId | null;
  /** null while the fuse value is pending randomness ("arming"). */
  fuseDeadline: number | null;
  fuseDuration: number;
  fuseSetAt: number;
  projectile: Projectile | null;
  protectedId: PlayerId | null;
  protectedUntil: number;
  lastGiverId: PlayerId | null;
}

export interface PickupSpot {
  pos: Vec2;
  available: boolean;
  respawnAt: number;
}

export type Phase = 'countdown' | 'intermission' | 'assigning' | 'active' | 'finished';

export type RandomPurpose = 'holder' | 'fuse' | 'pickup';

export interface RandomRequest {
  id: number;
  purpose: RandomPurpose;
  subject: PlayerId | null;
  requestedAt: number;
}

export type GameEvent =
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'holderAssigned'; holder: PlayerId; round: number }
  | { type: 'fuseSet'; holder: PlayerId; duration: number }
  | { type: 'transfer'; from: PlayerId; to: PlayerId; method: 'tag' | 'throw' | 'reflect'; fuseLeft: number }
  | { type: 'throw'; from: PlayerId; dir: Vec2 }
  | { type: 'miss'; from: PlayerId; at: Vec2 }
  | { type: 'blocked'; by: PlayerId; from: PlayerId }
  | { type: 'reflected'; by: PlayerId; to: PlayerId }
  | { type: 'dash'; id: PlayerId; emergency: boolean }
  | { type: 'pickupCollected'; id: PlayerId; spot: number }
  | { type: 'pickupRevealed'; id: PlayerId; ability: AbilityId }
  | { type: 'pickupRespawned'; spot: number }
  | { type: 'abilityUsed'; id: PlayerId; ability: AbilityId; target: PlayerId | null }
  | { type: 'abilityFailed'; id: PlayerId; ability: AbilityId; reason: string }
  | { type: 'swap'; a: PlayerId; b: PlayerId }
  | { type: 'elimination'; id: PlayerId; by: PlayerId | null; at: Vec2; survivors: number }
  | { type: 'matchEnd'; winner: PlayerId }
  | { type: 'inputRejected'; id: PlayerId; reason: string }
  | { type: 'transferRejected'; id: PlayerId; reason: string };

export interface MatchState {
  tick: number;
  time: number;
  phase: Phase;
  phaseEndsAt: number;
  round: number;
  roundStart: number;
  roundDeadline: number;
  players: PlayerState[];
  bomb: BombState;
  pickups: PickupSpot[];
  randomRequests: RandomRequest[];
  nextRequestId: number;
  winnerId: PlayerId | null;
  /** Events produced during the most recent tick. */
  events: GameEvent[];
}
