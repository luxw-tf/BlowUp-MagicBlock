import { describe, expect, it } from 'vitest';
import { BotBrain } from './bots';
import { CONFIG, TICK_DT } from './config';
import {
  computeFuse,
  createMatch,
  drainEvents,
  fulfillRandomness,
  fuseRange,
  getPlayer,
  holderCanAct,
  passLocked,
  step,
  type ParticipantSetup,
} from './sim';
import type { InputFrame, MatchState, PlayerId } from './types';

const PARTS: ParticipantSetup[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({
  id,
  name: id,
  character: (['frog', 'cat', 'blob', 'rat', 'duck', 'creature'] as const)[i],
  isBot: true,
}));

const bytesFor = (...u: number[]) => {
  const b = new Uint8Array(32);
  u.forEach((x, i) => {
    const n = Math.floor(x * 4294967296);
    b[i * 4] = (n >>> 24) & 255;
    b[i * 4 + 1] = (n >>> 16) & 255;
    b[i * 4 + 2] = (n >>> 8) & 255;
    b[i * 4 + 3] = n & 255;
  });
  return b;
};

const seqs = new Map<string, number>();
function frame(id: string, f: Partial<InputFrame> = {}): InputFrame {
  const seq = (seqs.get(id) ?? 0) + 1;
  seqs.set(id, seq);
  return { seq, move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, throw: false, tag: false, dash: false, use: false, ...f };
}

function run(s: MatchState, ticks: number, inputs: () => Map<PlayerId, InputFrame> = () => new Map()) {
  for (let i = 0; i < ticks; i++) step(s, inputs());
}

/** Start a match with `holder` holding the bomb and an armed fuse of u. */
function activeMatch(holderIndex = 0, fuseU = 0.5): MatchState {
  const s = createMatch(PARTS);
  run(s, Math.ceil(CONFIG.matchCountdown / TICK_DT) + 1);
  expect(s.phase).toBe('assigning');
  const req = s.randomRequests.find((r) => r.purpose === 'holder')!;
  expect(fulfillRandomness(s, req.id, bytesFor((holderIndex + 0.5) / 6, fuseU))).toBe(true);
  drainEvents(s);
  return s;
}

describe('bomb assignment', () => {
  it('waits in an explicit pending state until randomness arrives', () => {
    const s = createMatch(PARTS);
    run(s, 200);
    expect(s.phase).toBe('assigning');
    expect(s.bomb.holderId).toBeNull();
    const req = s.randomRequests.find((r) => r.purpose === 'holder')!;
    fulfillRandomness(s, req.id, bytesFor(0.99, 0));
    expect(s.bomb.holderId).toBe('f');
    expect(s.phase).toBe('active');
    // Shortest 6-player fuse (5 s) plus the opening-fuse bonus.
    expect(s.bomb.fuseDeadline! - s.time).toBeCloseTo(5 + CONFIG.openingFuseBonus, 5);
  });

  it('ignores duplicate or unknown fulfilments', () => {
    const s = activeMatch();
    expect(fulfillRandomness(s, 999, bytesFor(0.5))).toBe(false);
  });
});

describe('dynamic fuse', () => {
  it('uses round ranges and compresses with elapsed round time', () => {
    const s = activeMatch();
    expect(fuseRange(s)).toEqual([5, 11]);
    s.time = s.roundStart + 15; // factor 0.5 (30 s window)
    expect(fuseRange(s)).toEqual([2.5, 5.5]);
    s.time = s.roundStart + 29; // factor floors at 0.25 → [1.25, 2.75]
    expect(fuseRange(s)).toEqual([1.25, 2.75]);
  });

  it('never extends past the hard round deadline', () => {
    const s = activeMatch();
    s.time = s.roundDeadline - 0.5;
    expect(computeFuse(s, 1)).toBeCloseTo(0.5, 5);
  });

  it('enforces the nominal minimum', () => {
    const s = activeMatch();
    s.players.slice(0, 4).forEach((p) => (p.alive = false)); // 2 survivors → [4, 7]
    s.time = s.roundStart + 40; // factor 0.25 → [1, 1.75] → low end clamped to 1.25
    expect(fuseRange(s)).toEqual([1.25, 1.75]);
  });

  it('caps the opening-fuse bonus at the round deadline', () => {
    const s = createMatch(PARTS);
    run(s, Math.ceil(CONFIG.matchCountdown / TICK_DT) + 1);
    const req = s.randomRequests.find((r) => r.purpose === 'holder')!;
    fulfillRandomness(s, req.id, bytesFor(0.1, 0.999));
    // Longest 6-player fuse (~11 s) + 1.5 s bonus, still inside the 45 s round.
    expect(s.bomb.fuseDeadline! - s.time).toBeGreaterThan(12.4);
    expect(s.bomb.fuseDeadline!).toBeLessThanOrEqual(s.roundDeadline);
  });

  it('locks passing in the last fuseMinimum seconds of a round', () => {
    const s = activeMatch(0);
    const a = getPlayer(s, 'a')!;
    s.time = s.roundDeadline - CONFIG.fuseMinimum - 0.05;
    expect(passLocked(s)).toBe(false);
    expect(holderCanAct(s, a)).toBe(true);
    s.time = s.roundDeadline - CONFIG.fuseMinimum + 0.05;
    expect(passLocked(s)).toBe(true);
    expect(holderCanAct(s, a)).toBe(false);
  });
});

describe('transfers', () => {
  function adjacent(s: MatchState) {
    const a = getPlayer(s, 'a')!;
    const b = getPlayer(s, 'b')!;
    a.pos = { x: -10, z: -8 };
    b.pos = { x: -9, z: -8 };
    return { a, b };
  }

  it('tag transfers and resets the fuse after randomness', () => {
    const s = activeMatch(0);
    adjacent(s);
    step(s, new Map([['a', frame('a', { tag: true, aim: { x: -9, z: -8 } })]]));
    expect(s.bomb.holderId).toBe('b');
    expect(s.bomb.fuseDeadline).toBeNull();
    const req = s.randomRequests.find((r) => r.purpose === 'fuse')!;
    expect(req.subject).toBe('b');
    fulfillRandomness(s, req.id, bytesFor(0));
    expect(s.bomb.fuseDeadline).not.toBeNull();
  });

  it('transfer protection blocks an immediate tag-back', () => {
    const s = activeMatch(0);
    adjacent(s);
    step(s, new Map([['a', frame('a', { tag: true })]]));
    const req = s.randomRequests.find((r) => r.purpose === 'fuse')!;
    fulfillRandomness(s, req.id, bytesFor(0.5));
    step(s, new Map([['b', frame('b', { tag: true })]]));
    expect(s.bomb.holderId).toBe('b');
  });

  it('expiration takes precedence over a tag on the deadline tick', () => {
    const s = activeMatch(0);
    adjacent(s);
    s.bomb.fuseDeadline = s.time;
    step(s, new Map([['a', frame('a', { tag: true })]]));
    expect(getPlayer(s, 'a')!.alive).toBe(false);
    expect(s.phase).toBe('intermission');
  });

  it('a missed throw keeps ownership and applies recovery', () => {
    const s = activeMatch(0);
    const a = getPlayer(s, 'a')!;
    a.pos = { x: -12, z: -9 };
    step(s, new Map([['a', frame('a', { throw: true, aim: { x: -17, z: -9 } })]]));
    expect(s.bomb.projectile).not.toBeNull();
    run(s, 10);
    expect(s.bomb.projectile).toBeNull();
    expect(s.bomb.holderId).toBe('a');
    expect(a.stats.misses).toBe(1);
    expect(a.recoverUntil).toBeGreaterThan(s.time - 0.1);
  });

  it('fuse expiring mid-flight eliminates the thrower', () => {
    const s = activeMatch(0);
    const a = getPlayer(s, 'a')!;
    a.pos = { x: -12, z: -9 };
    step(s, new Map([['a', frame('a', { throw: true, aim: { x: 0, z: -9 } })]]));
    s.bomb.fuseDeadline = s.time;
    step(s, new Map());
    expect(a.alive).toBe(false);
    expect(s.bomb.projectile).toBeNull();
  });

  it('Not Today blocks and Return to Sender reflects', () => {
    const s = activeMatch(0);
    const { b } = adjacent(s);
    b.inventory = 'notToday';
    step(s, new Map([['b', frame('b', { use: true })]]));
    step(s, new Map([['a', frame('a', { tag: true })]]));
    expect(s.bomb.holderId).toBe('a');

    const s2 = activeMatch(0);
    const { b: b2 } = adjacent(s2);
    b2.inventory = 'returnToSender';
    step(s2, new Map([['b', frame('b', { use: true })]]));
    step(s2, new Map([['a', frame('a', { tag: true })]]));
    expect(s2.bomb.holderId).toBe('a');
    expect(s2.bomb.lastGiverId).toBe('b');
    expect(drainEvents(s2).some((e) => e.type === 'reflected')).toBe(true);
  });
});

describe('input validation', () => {
  it('rejects stale and duplicate sequence numbers', () => {
    const s = activeMatch(0);
    const f = frame('a', { move: { x: 1, z: 0 } });
    step(s, new Map([['a', f]]));
    step(s, new Map([['a', { ...f }]]));
    expect(drainEvents(s).some((e) => e.type === 'inputRejected' && e.id === 'a')).toBe(true);
  });

  it('clamps oversized movement vectors', () => {
    const s = activeMatch(0);
    const a = getPlayer(s, 'a')!;
    a.pos = { x: -12, z: -9 };
    run(s, 20, () => new Map([['a', frame('a', { move: { x: 100, z: 0 } })]]));
    expect(Math.hypot(a.vel.x, a.vel.z)).toBeLessThanOrEqual(CONFIG.moveSpeed + 1e-6);
  });
});

describe('full bot match', () => {
  it('six bots finish a match with exactly one winner in bounded time (also in a storm and in snow)', async () => {
    const { WEATHER_FX } = await import('./arena');
    for (let trial = 0; trial < 7; trial++) {
      const s = createMatch(PARTS);
      if (trial === 5) s.weatherFx = WEATHER_FX.storm;
      if (trial === 6) s.weatherFx = WEATHER_FX.snow;
      const brains = PARTS.map((p, i) => new BotBrain(p.id, 1234 + i * 7 + trial * 101));
      let rng = 99 + trial;
      const next = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
      const maxTicks = Math.ceil((CONFIG.matchCountdown + 5 * (CONFIG.roundHardDeadline + CONFIG.intermission + 1)) / TICK_DT);
      let ticks = 0;
      while (s.phase !== 'finished' && ticks < maxTicks) {
        for (const r of [...s.randomRequests]) fulfillRandomness(s, r.id, bytesFor(next(), next()));
        step(s, new Map(brains.map((b) => [b.id, b.decide(s)])));
        drainEvents(s);
        ticks++;
      }
      expect(s.phase).toBe('finished');
      expect(s.players.filter((p) => p.alive)).toHaveLength(1);
      expect(new Set(s.players.map((p) => p.placement))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    }
  });
});


describe('layouts', () => {
  it('keep every spawn and pickup clear and the whole yard reachable', async () => {
    const { LAYOUTS, SPAWNS, selectLayout, circleBlocked, PICKUP_SPOTS, ARENA, selectLayoutFor } = await import('./arena');
    const R = 0.55; // a little more than a player's radius
    for (let i = 0; i < LAYOUTS.length; i++) {
      selectLayout(i);
      for (const sp of SPAWNS) expect(circleBlocked(sp, R), `${LAYOUTS[i].id}: spawn ${sp.x},${sp.z}`).toBe(false);
      for (const pk of PICKUP_SPOTS) expect(circleBlocked(pk, R), `${LAYOUTS[i].id}: pickup ${pk.x},${pk.z}`).toBe(false);
      // flood fill on a 0.5 grid from the first spawn: every spawn and pickup must be reachable
      const step = 0.5, key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
      const seen = new Set<string>([key(SPAWNS[0].x, SPAWNS[0].z)]);
      const q = [{ ...SPAWNS[0] }];
      while (q.length) {
        const c = q.pop()!;
        for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
          const n = { x: c.x + dx, z: c.z + dz };
          const k = key(n.x, n.z);
          if (seen.has(k) || Math.abs(n.x) > ARENA.halfWidth || Math.abs(n.z) > ARENA.halfDepth || circleBlocked(n, R)) continue;
          seen.add(k); q.push(n);
        }
      }
      for (const t of [...SPAWNS, ...PICKUP_SPOTS]) expect(seen.has(key(t.x, t.z)), `${LAYOUTS[i].id}: reach ${t.x},${t.z}`).toBe(true);
    }
    // the same match address always gives the same layout
    expect(selectLayoutFor('Match111').id).toBe(selectLayoutFor('Match111').id);
    selectLayout(0);
  });

  it('pick the same weather from the same match address, and storms only at night', async () => {
    const { selectLayoutFor, currentMood, currentWeather, WEATHERS } = await import('./arena');
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const key = `Match${i * 7919}`;
      selectLayoutFor(key);
      const a = `${currentMood()}/${currentWeather()}`;
      selectLayoutFor('other');
      selectLayoutFor(key);
      expect(`${currentMood()}/${currentWeather()}`).toBe(a);
      if (currentWeather() === 'storm') expect(currentMood()).toBe('night');
      seen.add(currentWeather());
    }
    expect(seen.size).toBe(WEATHERS.length); // every weather turns up
  });

  it('move people with the weather only when the match carries it, the same for everyone', async () => {
    const { WEATHER_FX } = await import('./arena');
    // the rules themselves carry no weather: only the offline session adds it (never the on-chain mirror)
    expect(createMatch(PARTS.slice(0, 2)).weatherFx).toBeUndefined();
    // a wet deck makes a runner slide further when they let go
    const slide = (fx: keyof typeof WEATHER_FX | null) => {
      const s = createMatch(PARTS.slice(0, 2));
      if (fx) s.weatherFx = WEATHER_FX[fx];
      for (let i = 0; i < 20; i++) step(s, new Map([['a', frame('a', { move: { x: 0, z: 1 } })]]));
      const z0 = s.players[0].pos.z;
      for (let i = 0; i < 20; i++) step(s, new Map([['a', frame('a')]]));
      return s.players[0].pos.z - z0;
    };
    expect(slide('rain')).toBeGreaterThan(slide(null));
    // the wind drifts anyone standing still downwind, every player by exactly the same amount
    const s = createMatch(PARTS.slice(0, 2));
    s.weatherFx = WEATHER_FX.storm;
    const before = s.players.map((p) => ({ ...p.pos }));
    for (let i = 0; i < 10; i++) step(s, new Map());
    const drift = s.players.map((p, i) => p.pos.x - before[i].x);
    expect(drift[0]).toBeGreaterThan(0.3);
    expect(drift[1]).toBeCloseTo(drift[0], 6);
    // snow is heavy going: a 2 s run covers less ground
    const run = (fx: keyof typeof WEATHER_FX | null) => {
      const m = createMatch(PARTS.slice(0, 2));
      if (fx) m.weatherFx = { ...WEATHER_FX[fx]!, push: { x: 0, z: 0 } };
      const z0 = m.players[0].pos.z;
      for (let i = 0; i < 40; i++) step(m, new Map([['a', frame('a', { move: { x: 0, z: 1 } })]]));
      return m.players[0].pos.z - z0;
    };
    expect(run('snow')).toBeLessThan(run(null));
  });
});
