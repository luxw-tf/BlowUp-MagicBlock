/**
 * Bot brains. Bots read only public match state and produce the same
 * InputFrame a human would — they have no access to pending or future
 * randomness. Imperfection comes from reaction delay, aim error and
 * occasional mistakes, driven by a private per-bot PRNG.
 */
import { CONFIG } from './config';
import { ARENA, OBSTACLES, circleBlocked, currentLayout, segmentClear } from './arena';
import { add, dist, dot, len, norm, scale, sub, v } from './math';
import { alivePlayers, fuseRemaining, getPlayer, holderCanAct } from './sim';
import type { InputFrame, MatchState, PlayerState, Vec2 } from './types';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Navigation waypoints round whatever obstacles the current layout has, for one-hop path finding: a ring round each
 * round obstacle and the corners of each box. Built per layout (the yard changes between matches).
 */
let navFor = '';
let navNodes: Vec2[] = [];
function NAV(): Vec2[] {
  // the layout swaps OBSTACLES in place, so key the cache on the layout and its obstacle count
  const key = `${currentLayout().id}:${OBSTACLES.length}`;
  if (navFor === key) return navNodes;
  const nodes: Vec2[] = [];
  for (const o of OBSTACLES) {
    if (o.kind === 'circle') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        nodes.push({ x: o.x + Math.cos(a) * (o.r + 1.3), z: o.z + Math.sin(a) * (o.r + 1.3) });
      }
    } else {
      const m = 0.9;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) nodes.push({ x: o.x + sx * (o.hw + m), z: o.z + sz * (o.hd + m) });
    }
  }
  navNodes = nodes.filter((n) => !circleBlocked(n, CONFIG.playerRadius));
  navFor = key;
  return navNodes;
}

const R = CONFIG.playerRadius;

function waypointToward(from: Vec2, to: Vec2): Vec2 {
  if (segmentClear(from, to, R)) return to;
  let best: Vec2 | null = null;
  let bestCost = Infinity;
  for (const n of NAV()) {
    if (!segmentClear(from, n, R)) continue;
    const cost = dist(from, n) + dist(n, to) + (segmentClear(n, to, R) ? 0 : 6);
    if (cost < bestCost) {
      bestCost = cost;
      best = n;
    }
  }
  return best ?? to;
}

/** Rotate a desired direction until the path ahead is clear. */
function steer(pos: Vec2, desired: Vec2): Vec2 {
  const base = Math.atan2(desired.z, desired.x);
  for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.4, -2.4]) {
    const a = base + off;
    const d = { x: Math.cos(a), z: Math.sin(a) };
    if (!circleBlocked(add(pos, scale(d, 0.7)), R) && !circleBlocked(add(pos, scale(d, 1.3)), R * 0.8)) return d;
  }
  return desired;
}

function wallClearance(p: Vec2): number {
  return Math.min(ARENA.halfWidth - Math.abs(p.x), ARENA.halfDepth - Math.abs(p.z));
}

export class BotBrain {
  private rng: () => number;
  private seq = 0;
  private nextThinkAt = 0;
  private move: Vec2 = v();
  private aim: Vec2 = v();
  private pending = { tag: false, throw: false, dash: false, use: false };
  private readonly reaction: number;
  private readonly aimError: number;
  private readonly aggression: number;

  constructor(readonly id: string, seed: number) {
    this.rng = mulberry32(seed);
    // human-ish reactions (0.26 to 0.42 s): faster bots out-reacted people, who won about 5% of matches
    this.reaction = 0.26 + this.rng() * 0.16;
    this.aimError = 0.08 + this.rng() * 0.16;
    this.aggression = 0.4 + this.rng() * 0.5;
  }

  decide(s: MatchState): InputFrame {
    const me = getPlayer(s, this.id);
    if (me && me.alive && s.time >= this.nextThinkAt) {
      this.think(s, me);
      this.nextThinkAt = s.time + this.reaction * (0.7 + this.rng() * 0.6);
    }
    const frame: InputFrame = {
      seq: this.seq++,
      move: this.move,
      aim: this.aim,
      ...this.pending,
    };
    this.pending = { tag: false, throw: false, dash: false, use: false };
    return frame;
  }

  private think(s: MatchState, me: PlayerState) {
    // Occasional brain fart: keep doing whatever we were doing.
    if (this.rng() < 0.05) return;
    if (s.bomb.holderId === me.id) this.thinkHolder(s, me);
    else this.thinkRunner(s, me);
  }

  private thinkHolder(s: MatchState, me: PlayerState) {
    const fuse = fuseRemaining(s) ?? 99;
    const targets = alivePlayers(s).filter(
      (q) => q.id !== me.id && !(s.bomb.protectedId === q.id && s.time < s.bomb.protectedUntil),
    );
    if (targets.length === 0) return;
    const scored = targets
      .map((q) => ({ q, c: dist(me.pos, q.pos) + (segmentClear(me.pos, q.pos, CONFIG.bombRadius) ? 0 : 5) }))
      .sort((a, b) => a.c - b.c);
    const target = scored[0].q;
    const d = dist(me.pos, target.pos);

    const wp = waypointToward(me.pos, target.pos);
    this.move = steer(me.pos, norm(sub(wp, me.pos)));
    this.aim = { ...target.pos };

    if (!holderCanAct(s, me)) return;

    if (d <= CONFIG.tagRange * 0.92) {
      this.pending.tag = true;
      return;
    }

    const clear = segmentClear(me.pos, target.pos, CONFIG.bombRadius + 0.05);
    const urgency = fuse < 2.5 ? 0.85 : fuse < 4 ? 0.45 : 0.18 * this.aggression;
    if (clear && d < CONFIG.throwRange * 0.85 && this.rng() < urgency * (d < 5 ? 1.4 : 0.7)) {
      const flight = d / CONFIG.throwSpeed;
      const lead = add(target.pos, scale(target.vel, flight * (0.5 + this.rng() * 0.6)));
      const dir = sub(lead, me.pos);
      const ang = Math.atan2(dir.z, dir.x) + (this.rng() * 2 - 1) * this.aimError;
      this.aim = add(me.pos, { x: Math.cos(ang) * len(dir), z: Math.sin(ang) * len(dir) });
      this.pending.throw = true;
      return;
    }

    if (s.time >= me.dashReadyAt && d > 2 && d < 5.5 && this.rng() < 0.25 * this.aggression) this.pending.dash = true;

    const inv = me.inventory;
    if (inv === 'timeTheft' && fuse < 1.6) this.pending.use = true;
    if (inv === 'skillIssue' && d > 2 && d < CONFIG.slowRange) this.pending.use = true;
    if (inv === 'outtaHere' && d > 3 && d < 7) this.pending.use = true;
    if (inv === 'plotTwist' && fuse < 1.2) this.pending.use = true; // panic swap to scramble positions
  }

  private thinkRunner(s: MatchState, me: PlayerState) {
    const holder = getPlayer(s, s.bomb.holderId);
    const proj = s.bomb.projectile;

    // Dodge an incoming throw.
    if (proj && proj.ownerId !== me.id) {
      const rel = sub(me.pos, proj.pos);
      const along = dot(rel, proj.dir);
      if (along > 0) {
        const closest = len(sub(rel, scale(proj.dir, along)));
        const eta = along / CONFIG.throwSpeed;
        if (closest < 1.3 && eta < 0.5) {
          const perp = { x: -proj.dir.z, z: proj.dir.x };
          const side = dot(perp, rel) >= 0 ? 1 : -1;
          this.move = steer(me.pos, scale(perp, side));
          if (me.inventory === 'returnToSender' || me.inventory === 'notToday') this.pending.use = true;
          else if (s.time >= me.dashReadyAt && this.rng() < 0.55) this.pending.dash = true;
          return;
        }
      }
    }

    if (!holder) {
      this.wander(s, me);
      return;
    }

    const dh = dist(me.pos, holder.pos);
    this.aim = { ...holder.pos };

    // Defensive abilities.
    const inv = me.inventory;
    if (dh < 2.3) {
      if (inv === 'returnToSender' || inv === 'notToday' || inv === 'outtaHere') this.pending.use = true;
      if (inv === 'skillIssue') this.pending.use = true;
      if (inv === 'plotTwist') {
        const far = alivePlayers(s)
          .filter((q) => q.id !== me.id && q.id !== holder.id && dist(me.pos, q.pos) < CONFIG.swapRange)
          .sort((a, b) => dist(b.pos, holder.pos) - dist(a.pos, holder.pos))[0];
        if (far && dist(far.pos, holder.pos) > dh + 3) {
          this.aim = { ...far.pos };
          this.pending.use = true;
        }
      }
      if (!this.pending.use && s.time >= me.dashReadyAt && this.rng() < 0.6) this.pending.dash = true;
    } else if (inv === 'skillIssue' && dh < 5) {
      this.pending.use = true;
    }
    // Time Theft as a runner steals time off the holder's fuse: use it while you're safely away from them
    const holderFuse = fuseRemaining(s);
    if (inv === 'timeTheft' && holderFuse !== null && holderFuse > 2.2 && dh > 4 && this.rng() < 0.05) this.pending.use = true;

    // Grab a pickup if it is safe-ish.
    if (me.inventory === null && dh > 6) {
      const spot = s.pickups
        .filter((p) => p.available && dist(p.pos, me.pos) < dist(p.pos, holder.pos) - 1.5)
        .sort((a, b) => dist(a.pos, me.pos) - dist(b.pos, me.pos))[0];
      if (spot && dist(spot.pos, me.pos) < 9) {
        const wp = waypointToward(me.pos, spot.pos);
        this.move = steer(me.pos, norm(sub(wp, me.pos)));
        return;
      }
    }

    if (dh > 11) {
      this.wander(s, me);
      return;
    }

    // Flee: sample directions and score distance, wall clearance and cover.
    let best = this.move;
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = { x: Math.cos(a), z: Math.sin(a) };
      const p1 = add(me.pos, scale(d, 1));
      const p2 = add(me.pos, scale(d, 2.5));
      if (circleBlocked(p1, R)) continue;
      let score = dist(p2, holder.pos) * 1.2;
      score += Math.min(wallClearance(p2), 3.5) * 0.9;
      if (circleBlocked(p2, R)) score -= 2.5;
      if (!segmentClear(holder.pos, p2, CONFIG.bombRadius)) score += 1.2; // hide behind cover
      score += dot(d, norm(this.move)) * 0.6; // smoothness
      score += (this.rng() - 0.5) * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    this.move = best;
  }

  private wander(_s: MatchState, me: PlayerState) {
    if (len(this.move) < 0.1 || this.rng() < 0.15 || circleBlocked(add(me.pos, scale(this.move, 1.2)), R)) {
      const target = { x: (this.rng() * 2 - 1) * 14, z: (this.rng() * 2 - 1) * 7 };
      this.move = steer(me.pos, norm(sub(waypointToward(me.pos, target), me.pos)));
    }
  }
}
