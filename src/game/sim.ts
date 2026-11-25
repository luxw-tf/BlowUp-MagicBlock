/**
 * Authoritative match simulation.
 *
 * Pure, tick-based and renderer-independent: given the same state, inputs and
 * randomness fulfilments it always produces the same result. This is the logic
 * that is intended to move into the MagicBlock Ephemeral Rollup program; the
 * browser only renders, predicts and interpolates.
 *
 * Randomness is never generated here. Decisive draws (bomb holder, fuse length,
 * pickup reward) are emitted as explicit requests and the match waits in a
 * visible pending state until `fulfillRandomness` is called with the value.
 */
import { CONFIG, TICK_DT } from './config';
import { PICKUP_SPOTS, SPAWNS, circleBlocked, resolveCircle, segmentClear } from './arena';
import { add, dist, isFiniteVec, len, norm, scale, sub, v } from './math';
import type {
  AbilityId,
  CharacterId,
  GameEvent,
  InputFrame,
  MatchState,
  PlayerId,
  Phase,
  PlayerState,
  RandomPurpose,
} from './types';

export const ABILITIES: AbilityId[] = [
  'returnToSender',
  'notToday',
  'outtaHere',
  'plotTwist',
  'skillIssue',
  'timeTheft',
];

export interface ParticipantSetup {
  id: PlayerId;
  name: string;
  character: CharacterId;
  isBot: boolean;
}

const emptyStats = () => ({
  tags: 0,
  throws: 0,
  throwHits: 0,
  misses: 0,
  reflects: 0,
  blocks: 0,
  dashes: 0,
  pickups: 0,
  abilitiesUsed: 0,
  timeHolding: 0,
  closeCalls: 0,
  received: 0,
});

export function createMatch(participants: ParticipantSetup[]): MatchState {
  if (participants.length < 2 || participants.length > SPAWNS.length) {
    throw new Error(`A match needs 2–${SPAWNS.length} participants`);
  }
  const players: PlayerState[] = participants.map((p, i) => {
    const pos = { ...SPAWNS[i] };
    return {
      ...p,
      alive: true,
      pos,
      vel: v(),
      aim: { x: 0, z: 0 },
      dashUntil: 0,
      dashDir: v(1, 0),
      dashSpeed: 0,
      dashReadyAt: 0,
      slowUntil: 0,
      recoverUntil: 0,
      inventory: null,
      shield: null,
      shieldUntil: 0,
      lastSeq: -1,
      eliminatedAt: null,
      placement: null,
      stats: emptyStats(),
    };
  });
  return {
    tick: 0,
    time: 0,
    phase: 'countdown',
    phaseEndsAt: CONFIG.matchCountdown,
    round: 0,
    roundStart: 0,
    roundDeadline: Infinity,
    players,
    bomb: {
      holderId: null,
      fuseDeadline: null,
      fuseDuration: 0,
      fuseSetAt: 0,
      projectile: null,
      protectedId: null,
      protectedUntil: 0,
      lastGiverId: null,
    },
    pickups: PICKUP_SPOTS.map((pos) => ({ pos: { ...pos }, available: true, respawnAt: 0 })),
    randomRequests: [],
    nextRequestId: 1,
    winnerId: null,
    events: [],
  };
}

// ───────────────────────────── helpers ─────────────────────────────

export const getPlayer = (s: MatchState, id: PlayerId | null): PlayerState | undefined =>
  id === null ? undefined : s.players.find((p) => p.id === id);

export const alivePlayers = (s: MatchState): PlayerState[] => s.players.filter((p) => p.alive);

/** Remaining fuse in seconds, or null while unassigned / pending. */
export function fuseRemaining(s: MatchState): number | null {
  if (s.phase !== 'active' || s.bomb.fuseDeadline === null) return null;
  return Math.max(0, s.bomb.fuseDeadline - s.time);
}

/** Map 4 bytes of a 32-byte randomness value to a uniform in [0, 1). */
export function uniformFrom(bytes: Uint8Array, index: number): number {
  const o = (index * 4) % bytes.length;
  const n = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return n / 4294967296;
}

/** Fuse range for the current round after time compression (PRD §05). */
export function fuseRange(s: MatchState): [number, number] {
  const survivors = alivePlayers(s).length;
  const [lo, hi] = CONFIG.fuseRanges[survivors] ?? CONFIG.fuseRanges[2];
  const elapsed = Math.max(0, s.time - s.roundStart);
  const f = Math.max(CONFIG.compressionFloor, 1 - elapsed / CONFIG.compressionWindow);
  return [Math.max(CONFIG.fuseMinimum, lo * f), Math.max(CONFIG.fuseMinimum, hi * f)];
}

export function computeFuse(s: MatchState, u: number): number {
  const [lo, hi] = fuseRange(s);
  const d = lo + u * (hi - lo);
  // The hard round deadline overrides the nominal minimum.
  return Math.min(d, Math.max(0, s.roundDeadline - s.time));
}

function emit(s: MatchState, e: GameEvent) {
  s.events.push(e);
}

function requestRandom(s: MatchState, purpose: RandomPurpose, subject: PlayerId | null) {
  s.randomRequests.push({ id: s.nextRequestId++, purpose, subject, requestedAt: s.time });
}

function isProtected(s: MatchState, id: PlayerId): boolean {
  return s.bomb.protectedId === id && s.time < s.bomb.protectedUntil;
}

/** Holder may tag/throw only once the fuse is armed and nothing is in flight. */
export function holderCanAct(s: MatchState, p: PlayerState): boolean {
  return (
    s.phase === 'active' &&
    p.alive &&
    s.bomb.holderId === p.id &&
    s.bomb.fuseDeadline !== null &&
    s.bomb.projectile === null &&
    s.time >= p.recoverUntil
  );
}

/** Valid tag targets, best first. */
export function tagCandidates(s: MatchState, p: PlayerState, aim: { x: number; z: number }): PlayerState[] {
  const aimDir = norm(sub(aim, p.pos));
  return s.players
    .filter(
      (q) =>
        q.alive &&
        q.id !== p.id &&
        !isProtected(s, q.id) &&
        dist(p.pos, q.pos) <= CONFIG.tagRange &&
        segmentClear(p.pos, q.pos, 0.05),
    )
    .map((q) => {
      const d = dist(p.pos, q.pos);
      const facing = len(aimDir) > 0 ? 1 - Math.max(0, (q.pos.x - p.pos.x) * aimDir.x + (q.pos.z - p.pos.z) * aimDir.z) / Math.max(d, 1e-3) : 0;
      return { q, score: d + facing * 0.6 };
    })
    .sort((a, b) => a.score - b.score)
    .map((c) => c.q);
}

/** Target for aimed abilities: nearest to the aim point within range with clear line of sight. */
export function abilityTarget(s: MatchState, p: PlayerState, aim: { x: number; z: number }, range: number) {
  let best: PlayerState | undefined;
  let bestD = Infinity;
  for (const q of s.players) {
    if (!q.alive || q.id === p.id) continue;
    if (dist(p.pos, q.pos) > range) continue;
    if (!segmentClear(p.pos, q.pos, 0.1)) continue;
    const d = dist(q.pos, aim);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

// ───────────────────────────── bomb transfer ─────────────────────────────

function giveBomb(s: MatchState, from: PlayerState, to: PlayerState, method: 'tag' | 'throw' | 'reflect') {
  const fuseLeft = s.bomb.fuseDeadline === null ? 0 : Math.max(0, s.bomb.fuseDeadline - s.time);
  s.bomb.holderId = to.id;
  s.bomb.fuseDeadline = null; // arming: new fuse awaits randomness
  s.bomb.projectile = null;
  s.bomb.lastGiverId = from.id;
  s.bomb.protectedId = from.id;
  s.bomb.protectedUntil = s.time + CONFIG.transferProtection;
  to.stats.received++;
  if (method === 'tag') from.stats.tags++;
  if (fuseLeft < CONFIG.closeCallThreshold) from.stats.closeCalls++;
  // Drop any stale fuse request for a previous holder.
  s.randomRequests = s.randomRequests.filter((r) => r.purpose !== 'fuse');
  requestRandom(s, 'fuse', to.id);
  emit(s, { type: 'transfer', from: from.id, to: to.id, method, fuseLeft });
}

/** Resolves an incoming transfer, honouring Not Today / Return to Sender. */
function attemptTransfer(s: MatchState, from: PlayerState, to: PlayerState, method: 'tag' | 'throw') {
  if (to.shield && s.time < to.shieldUntil) {
    const kind = to.shield;
    to.shield = null;
    to.shieldUntil = 0;
    if (kind === 'block') {
      to.stats.blocks++;
      s.bomb.projectile = null;
      from.recoverUntil = s.time + CONFIG.missRecovery;
      emit(s, { type: 'blocked', by: to.id, from: from.id });
      return;
    }
    // Explicit reflection: ignores transfer protection.
    to.stats.reflects++;
    emit(s, { type: 'reflected', by: to.id, to: from.id });
    giveBomb(s, to, from, 'reflect');
    return;
  }
  giveBomb(s, from, to, method);
}

function eliminate(s: MatchState, p: PlayerState) {
  const survivorsBefore = alivePlayers(s).length;
  const by = s.bomb.lastGiverId;
  p.alive = false;
  p.eliminatedAt = s.time;
  p.placement = survivorsBefore;
  p.inventory = null;
  p.shield = null;
  p.vel = v();
  s.bomb.holderId = null;
  s.bomb.fuseDeadline = null;
  s.bomb.projectile = null;
  s.bomb.protectedId = null;
  s.bomb.lastGiverId = null;
  s.randomRequests = s.randomRequests.filter(
    (r) => r.purpose !== 'fuse' && !(r.purpose === 'pickup' && r.subject === p.id),
  );
  const survivors = survivorsBefore - 1;
  emit(s, { type: 'elimination', id: p.id, by, at: { ...p.pos }, survivors });

  if (survivors <= 1) {
    const winner = alivePlayers(s)[0];
    s.phase = 'finished';
    s.winnerId = winner?.id ?? null;
    if (winner) {
      winner.placement = 1;
      emit(s, { type: 'matchEnd', winner: winner.id });
    }
  } else {
    s.phase = 'intermission';
    s.phaseEndsAt = s.time + CONFIG.intermission;
  }
}

// ───────────────────────────── randomness ─────────────────────────────

/**
 * Apply a randomness fulfilment. Returns false for unknown / stale / duplicate
 * request ids, which are ignored without side effects.
 */
export function fulfillRandomness(s: MatchState, requestId: number, bytes: Uint8Array): boolean {
  const idx = s.randomRequests.findIndex((r) => r.id === requestId);
  if (idx < 0 || bytes.length < 8) return false;
  const req = s.randomRequests[idx];
  s.randomRequests.splice(idx, 1);

  if (req.purpose === 'holder') {
    if (s.phase !== 'assigning') return false;
    const survivors = alivePlayers(s);
    const holder = survivors[Math.floor(uniformFrom(bytes, 0) * survivors.length)];
    s.phase = 'active';
    s.round = s.players.length - survivors.length + 1;
    s.roundStart = s.time;
    s.roundDeadline = s.time + CONFIG.roundHardDeadline;
    s.bomb.holderId = holder.id;
    s.bomb.lastGiverId = null;
    s.bomb.protectedId = null;
    holder.stats.received++;
    emit(s, { type: 'holderAssigned', holder: holder.id, round: s.round });
    setFuse(s, uniformFrom(bytes, 1));
    return true;
  }

  if (req.purpose === 'fuse') {
    if (s.phase !== 'active' || s.bomb.holderId !== req.subject || s.bomb.fuseDeadline !== null) return false;
    setFuse(s, uniformFrom(bytes, 0));
    return true;
  }

  // pickup reward
  const p = getPlayer(s, req.subject);
  if (!p || !p.alive || p.inventory !== 'pending') return false;
  const ability = ABILITIES[Math.floor(uniformFrom(bytes, 0) * ABILITIES.length)];
  p.inventory = ability;
  emit(s, { type: 'pickupRevealed', id: p.id, ability });
  return true;
}

function setFuse(s: MatchState, u: number) {
  const d = computeFuse(s, u);
  s.bomb.fuseDuration = d;
  s.bomb.fuseSetAt = s.time;
  s.bomb.fuseDeadline = s.time + d;
  emit(s, { type: 'fuseSet', holder: s.bomb.holderId!, duration: d });
}

// ───────────────────────────── input validation ─────────────────────────────

function sanitize(s: MatchState, p: PlayerState, inp: InputFrame | undefined): InputFrame | null {
  if (!inp) return null;
  if (!Number.isInteger(inp.seq) || inp.seq <= p.lastSeq) {
    emit(s, { type: 'inputRejected', id: p.id, reason: 'stale or duplicate sequence' });
    return null;
  }
  if (!isFiniteVec(inp.move) || !isFiniteVec(inp.aim)) {
    emit(s, { type: 'inputRejected', id: p.id, reason: 'malformed vector' });
    return null;
  }
  p.lastSeq = inp.seq;
  const m = len(inp.move);
  return {
    seq: inp.seq,
    move: m > 1 ? scale(inp.move, 1 / m) : { ...inp.move },
    aim: { ...inp.aim },
    throw: !!inp.throw,
    tag: !!inp.tag,
    dash: !!inp.dash,
    use: !!inp.use,
  };
}

// ───────────────────────────── per-player actions ─────────────────────────────

function startDash(s: MatchState, p: PlayerState, inp: InputFrame, distance: number, duration: number) {
  let dir = norm(inp.move);
  if (len(dir) === 0) dir = norm(len(p.vel) > 0.5 ? p.vel : sub(inp.aim, p.pos));
  if (len(dir) === 0) dir = v(1, 0);
  p.dashDir = dir;
  p.dashSpeed = distance / duration;
  p.dashUntil = s.time + duration;
}

function useAbility(s: MatchState, p: PlayerState, inp: InputFrame) {
  const ability = p.inventory;
  if (!ability || ability === 'pending') return;
  if (s.phase !== 'active' && ability !== 'outtaHere') {
    emit(s, { type: 'abilityFailed', id: p.id, ability, reason: 'no bomb in play' });
    return;
  }
  let target: PlayerState | undefined;
  switch (ability) {
    case 'returnToSender':
      p.shield = 'reflect';
      p.shieldUntil = s.time + CONFIG.reflectWindow;
      break;
    case 'notToday':
      p.shield = 'block';
      p.shieldUntil = s.time + CONFIG.blockWindow;
      break;
    case 'outtaHere':
      startDash(s, p, inp, CONFIG.emergencyDashDistance, CONFIG.emergencyDashDuration);
      emit(s, { type: 'dash', id: p.id, emergency: true });
      break;
    case 'plotTwist': {
      target = abilityTarget(s, p, inp.aim, CONFIG.swapRange);
      if (!target) {
        emit(s, { type: 'abilityFailed', id: p.id, ability, reason: 'no target in range' });
        return;
      }
      const a = p.pos;
      p.pos = target.pos;
      target.pos = a;
      p.vel = v();
      target.vel = v();
      p.dashUntil = 0;
      target.dashUntil = 0;
      emit(s, { type: 'swap', a: p.id, b: target.id });
      break;
    }
    case 'skillIssue':
      target = abilityTarget(s, p, inp.aim, CONFIG.slowRange);
      if (!target) {
        emit(s, { type: 'abilityFailed', id: p.id, ability, reason: 'no target in range' });
        return;
      }
      target.slowUntil = s.time + CONFIG.slowDuration;
      break;
    case 'timeTheft':
      if (s.bomb.fuseDeadline === null) {
        emit(s, { type: 'abilityFailed', id: p.id, ability, reason: 'fuse not armed' });
        return;
      }
      s.bomb.fuseDeadline = Math.min(s.bomb.fuseDeadline + CONFIG.timeTheftSeconds, s.roundDeadline);
      break;
  }
  p.inventory = null;
  p.stats.abilitiesUsed++;
  emit(s, { type: 'abilityUsed', id: p.id, ability, target: target?.id ?? null });
}

function movePlayer(s: MatchState, p: PlayerState, inp: InputFrame | null) {
  const slow = s.time < p.slowUntil ? 1 - CONFIG.slowFactor : 1;
  const maxSpeed = CONFIG.moveSpeed * slow;
  if (s.time < p.dashUntil) {
    p.vel = scale(p.dashDir, p.dashSpeed * slow);
  } else {
    if (len(p.vel) > maxSpeed) p.vel = scale(norm(p.vel), maxSpeed); // no post-dash slide
    const target = scale(inp ? inp.move : v(), maxSpeed);
    let dv = sub(target, p.vel);
    const rate = len(target) >= len(p.vel) ? CONFIG.acceleration : CONFIG.deceleration;
    const maxDv = rate * TICK_DT;
    if (len(dv) > maxDv) dv = scale(norm(dv), maxDv);
    p.vel = add(p.vel, dv);
  }
  const before = p.pos;
  p.pos = resolveCircle(add(p.pos, scale(p.vel, TICK_DT)), CONFIG.playerRadius);
  // Bleed velocity into walls so acceleration doesn't build up against them.
  const actual = scale(sub(p.pos, before), 1 / TICK_DT);
  if (s.time >= p.dashUntil && len(actual) < len(p.vel) - 0.01) p.vel = actual;
}

function separatePlayers(s: MatchState) {
  const alive = alivePlayers(s);
  const min = CONFIG.playerRadius * 2;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const d = dist(a.pos, b.pos);
      if (d >= min) continue;
      const n = d > 1e-4 ? scale(sub(b.pos, a.pos), 1 / d) : v(1, 0);
      const push = (min - d) * CONFIG.playerSeparation * 0.5;
      a.pos = resolveCircle(sub(a.pos, scale(n, push)), CONFIG.playerRadius);
      b.pos = resolveCircle(add(b.pos, scale(n, push)), CONFIG.playerRadius);
    }
  }
}

function updateProjectile(s: MatchState) {
  const proj = s.bomb.projectile;
  if (!proj) return;
  const owner = getPlayer(s, proj.ownerId)!;
  const substeps = 4;
  const stepLen = (CONFIG.throwSpeed * TICK_DT) / substeps;
  const hitR = CONFIG.playerRadius + CONFIG.bombRadius;
  for (let i = 0; i < substeps; i++) {
    proj.pos = add(proj.pos, scale(proj.dir, stepLen));
    proj.traveled += stepLen;
    let hit: PlayerState | undefined;
    let hitD = Infinity;
    for (const q of s.players) {
      if (!q.alive || q.id === proj.ownerId || isProtected(s, q.id)) continue;
      const d = dist(proj.pos, q.pos);
      if (d <= hitR && d < hitD) {
        hit = q;
        hitD = d;
      }
    }
    if (hit) {
      owner.stats.throwHits++;
      s.bomb.projectile = null;
      attemptTransfer(s, owner, hit, 'throw');
      return;
    }
    if (circleBlocked(proj.pos, CONFIG.bombRadius) || proj.traveled >= CONFIG.throwRange) {
      s.bomb.projectile = null;
      owner.recoverUntil = s.time + CONFIG.missRecovery;
      owner.stats.misses++;
      emit(s, { type: 'miss', from: owner.id, at: { ...proj.pos } });
      return;
    }
  }
}

// ───────────────────────────── tick ─────────────────────────────

/** Returns and clears events produced since the last drain (ticks and fulfilments). */
export function drainEvents(s: MatchState): GameEvent[] {
  const e = s.events;
  s.events = [];
  return e;
}

/**
 * Advance one fixed tick. Events accumulate in `s.events` until drained, so
 * fulfilments applied between ticks are not lost.
 */
export function step(s: MatchState, inputs: ReadonlyMap<PlayerId, InputFrame>): MatchState {
  if (s.phase === 'finished') {
    s.tick++;
    s.time = s.tick * TICK_DT;
    return s;
  }

  // Phase transitions.
  if ((s.phase === 'countdown' || s.phase === 'intermission') && s.time >= s.phaseEndsAt) {
    s.phase = 'assigning';
    requestRandom(s, 'holder', null);
  }

  // Expiration takes precedence over any action this tick.
  if (s.phase === 'active' && s.bomb.holderId) {
    const holder = getPlayer(s, s.bomb.holderId)!;
    const fuseOut = s.bomb.fuseDeadline !== null && s.time >= s.bomb.fuseDeadline;
    if (fuseOut || s.time >= s.roundDeadline) eliminate(s, holder);
  }
  if ((s.phase as Phase) === 'finished') {
    s.tick++;
    s.time = s.tick * TICK_DT;
    return s;
  }

  const frames = new Map<PlayerId, InputFrame | null>();
  for (const p of s.players) if (p.alive) frames.set(p.id, sanitize(s, p, inputs.get(p.id)));

  for (const p of s.players) {
    if (!p.alive) continue;
    const inp = frames.get(p.id) ?? null;
    if (p.shield && s.time >= p.shieldUntil) p.shield = null;
    if (inp) {
      p.aim = inp.aim;
      if (inp.use) useAbility(s, p, inp);
      if (inp.dash && s.time >= p.dashReadyAt && s.time >= p.dashUntil) {
        startDash(s, p, inp, CONFIG.dashDistance, CONFIG.dashDuration);
        p.dashReadyAt = s.time + CONFIG.dashCooldown;
        p.stats.dashes++;
        emit(s, { type: 'dash', id: p.id, emergency: false });
      }
    }
    movePlayer(s, p, inp);
  }
  separatePlayers(s);

  // Bomb actions, resolved after movement so ranges use fresh positions.
  for (const p of s.players) {
    const inp = frames.get(p.id);
    if (!inp || !holderCanAct(s, p)) continue;
    if (inp.tag) {
      const target = tagCandidates(s, p, inp.aim)[0];
      if (target) attemptTransfer(s, p, target, 'tag');
    } else if (inp.throw) {
      let dir = norm(sub(inp.aim, p.pos));
      if (len(dir) === 0) dir = norm(p.vel);
      if (len(dir) === 0) dir = v(1, 0);
      s.bomb.projectile = {
        ownerId: p.id,
        pos: add(p.pos, scale(dir, CONFIG.playerRadius * 0.5)),
        dir,
        traveled: 0,
      };
      p.stats.throws++;
      emit(s, { type: 'throw', from: p.id, dir });
    }
  }
  updateProjectile(s);

  // Pickups.
  s.pickups.forEach((spot, i) => {
    if (!spot.available) {
      if (s.time >= spot.respawnAt) {
        spot.available = true;
        emit(s, { type: 'pickupRespawned', spot: i });
      }
      return;
    }
    for (const p of s.players) {
      if (!p.alive || p.inventory !== null) continue;
      if (dist(p.pos, spot.pos) > CONFIG.playerRadius + CONFIG.pickupRadius) continue;
      spot.available = false;
      spot.respawnAt = s.time + CONFIG.pickupRespawn;
      p.inventory = 'pending';
      p.stats.pickups++;
      requestRandom(s, 'pickup', p.id);
      emit(s, { type: 'pickupCollected', id: p.id, spot: i });
      break;
    }
  });

  if (s.phase === 'active' && s.bomb.holderId) {
    const h = getPlayer(s, s.bomb.holderId);
    if (h) h.stats.timeHolding += TICK_DT;
  }

  s.tick++;
  s.time = s.tick * TICK_DT;
  return s;
}
