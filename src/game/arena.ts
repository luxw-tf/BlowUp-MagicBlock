import type { Vec2 } from './types';
import { clamp, dist, sub, len } from './math';

/**
 * Map 01: The Docks. Playable area is 36 × 20 units centred on the origin.
 * +x is screen-right, +z is toward the camera (screen-down).
 */
export const ARENA = {
  halfWidth: 18,
  halfDepth: 10,
};

export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number; tag: string }
  | { kind: 'box'; x: number; z: number; hw: number; hd: number; tag: string };

/**
 * Layouts. Spawns are shared by every layout (the on-chain program knows them); obstacles and pickup spots vary.
 * Obstacles are client-side only (not enforced on-chain), so a layout only has to be the same for everyone in a match:
 * offline it is picked at random, online it is derived from the match address (see selectLayoutFor).
 * Tags decide the look: basin / tub (water), barrels, crate, container, stack (stacked containers), stall.
 */
export interface Layout { id: string; name: string; obstacles: Obstacle[]; pickups: Vec2[] }

const box = (x: number, z: number, hw: number, hd: number, tag: string): Obstacle => ({ kind: 'box', x, z, hw, hd, tag });
const circle = (x: number, z: number, r: number, tag: string): Obstacle => ({ kind: 'circle', x, z, r, tag });

export const LAYOUTS: Layout[] = [
  {
    id: 'fountain',
    name: 'Fountain Square',
    obstacles: [
      circle(0, 0, 2.8, 'basin'),
      box(-8, -4.2, 0.9, 0.9, 'crate'), box(8, -4.2, 0.9, 0.9, 'crate'), box(-8, 4.2, 0.9, 0.9, 'crate'), box(8, 4.2, 0.9, 0.9, 'crate'),
      box(-13.6, 0, 0.7, 1.4, 'container'), box(13.6, 0, 0.7, 1.4, 'container'),
    ],
    pickups: [{ x: -5.5, z: 0 }, { x: 5.5, z: 0 }, { x: -16, z: -7.5 }, { x: 16, z: 7.5 }],
  },
  {
    id: 'alley',
    name: 'Container Alley',
    obstacles: [
      box(-7, -3, 3.2, 0.75, 'container'), box(7, 3, 3.2, 0.75, 'container'),
      box(0, 0, 0.9, 0.9, 'crate'),
      box(-14, 2.6, 0.8, 0.8, 'crate'), box(14, -2.6, 0.8, 0.8, 'crate'),
      circle(-3.4, 3.6, 0.7, 'barrels'), circle(3.4, -3.6, 0.7, 'barrels'),
    ],
    pickups: [{ x: -3.2, z: 0 }, { x: 3.2, z: 0 }, { x: -16, z: -7.5 }, { x: 16, z: 7.5 }],
  },
  {
    id: 'crane',
    name: 'Crane Yard',
    obstacles: [
      box(0, 0, 2.4, 1.2, 'stack'),
      circle(-7, -3.4, 0.9, 'barrels'), circle(7, 3.4, 0.9, 'barrels'), circle(-7, 3.4, 0.9, 'barrels'), circle(7, -3.4, 0.9, 'barrels'),
      box(-14, 0, 0.7, 1.4, 'crate'), box(14, 0, 0.7, 1.4, 'container'),
    ],
    pickups: [{ x: -4.5, z: 0 }, { x: 4.5, z: 0 }, { x: -16, z: -7.5 }, { x: 16, z: 7.5 }],
  },
  {
    id: 'market',
    name: 'Fish Market',
    obstacles: [
      circle(0, 0, 1.5, 'tub'),
      box(-5, -2.6, 1.3, 0.55, 'stall'), box(5, -2.6, 1.3, 0.55, 'stall'), box(-5, 2.6, 1.3, 0.55, 'stall'), box(5, 2.6, 1.3, 0.55, 'stall'),
      box(-11, 0, 0.8, 0.8, 'crate'), box(11, 0, 0.8, 0.8, 'crate'),
      circle(-15.5, -3, 0.7, 'barrels'), circle(15.5, 3, 0.7, 'barrels'),
    ],
    pickups: [{ x: 0, z: -3.4 }, { x: 0, z: 3.4 }, { x: -16, z: -7.5 }, { x: 16, z: 7.5 }],
  },
];

/** The live layout. These arrays are swapped in place, so everything that imported them sees the current map. */
export const OBSTACLES: Obstacle[] = [...LAYOUTS[0].obstacles];
let layoutIndex = 0;

/** Time of day: purely visual, but picked with the layout so everyone in a match sees the same sky. */
export const MOODS = ['morning', 'noon', 'sunset', 'night'] as const;
export type Mood = (typeof MOODS)[number];
let moodIndex = 1;
export const currentMood = (): Mood => MOODS[moodIndex];
export function selectMood(index: number): Mood {
  moodIndex = ((index % MOODS.length) + MOODS.length) % MOODS.length;
  return MOODS[moodIndex];
}

export function selectLayout(index: number): Layout {
  layoutIndex = ((index % LAYOUTS.length) + LAYOUTS.length) % LAYOUTS.length;
  const l = LAYOUTS[layoutIndex];
  OBSTACLES.splice(0, OBSTACLES.length, ...l.obstacles);
  PICKUP_SPOTS.splice(0, PICKUP_SPOTS.length, ...l.pickups.map((q) => ({ ...q })));
  return l;
}
export const currentLayout = (): Layout => LAYOUTS[layoutIndex];

/** Same key, same layout: online matches use the match address, so every client and the lobby's bots agree. */
export function selectLayoutFor(key: string): Layout {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  selectMood(Math.abs(h >> 8));
  return selectLayout(Math.abs(h));
}

export const SPAWNS: Vec2[] = [
  { x: -12, z: -6 },
  { x: 0, z: -6.5 },
  { x: 12, z: -6 },
  { x: 12, z: 6 },
  { x: 0, z: 6.5 },
  { x: -12, z: 6 },
];

export const PICKUP_SPOTS: Vec2[] = LAYOUTS[0].pickups.map((q) => ({ ...q }));

/** Push a circle of radius r out of all obstacles and keep it inside bounds. */
export function resolveCircle(p: Vec2, r: number): Vec2 {
  let { x, z } = p;
  for (const o of OBSTACLES) {
    if (o.kind === 'circle') {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + r;
      if (d < min) {
        if (d < 1e-6) {
          x = o.x + min;
        } else {
          x = o.x + (dx / d) * min;
          z = o.z + (dz / d) * min;
        }
      }
    } else {
      const cx = clamp(x, o.x - o.hw, o.x + o.hw);
      const cz = clamp(z, o.z - o.hd, o.z + o.hd);
      const dx = x - cx;
      const dz = z - cz;
      const d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-6) {
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // Centre is inside the box: push out along the shallowest axis.
          const px = o.hw + r - Math.abs(x - o.x);
          const pz = o.hd + r - Math.abs(z - o.z);
          if (px < pz) x += Math.sign(x - o.x || 1) * px;
          else z += Math.sign(z - o.z || 1) * pz;
        }
      }
    }
  }
  x = clamp(x, -ARENA.halfWidth + r, ARENA.halfWidth - r);
  z = clamp(z, -ARENA.halfDepth + r, ARENA.halfDepth - r);
  return { x, z };
}

/** True when a circle of radius r at p overlaps an obstacle or leaves the arena. */
export function circleBlocked(p: Vec2, r: number): boolean {
  if (Math.abs(p.x) > ARENA.halfWidth - r || Math.abs(p.z) > ARENA.halfDepth - r) return true;
  for (const o of OBSTACLES) {
    if (o.kind === 'circle') {
      if (dist(p, o) < o.r + r) return true;
    } else {
      const cx = clamp(p.x, o.x - o.hw, o.x + o.hw);
      const cz = clamp(p.z, o.z - o.hd, o.z + o.hd);
      if (Math.hypot(p.x - cx, p.z - cz) < r) return true;
    }
  }
  return false;
}

/** Line-of-sight test by sampling the segment against obstacles inflated by r. */
export function segmentClear(a: Vec2, b: Vec2, r = 0): boolean {
  const d = sub(b, a);
  const l = len(d);
  const steps = Math.max(1, Math.ceil(l / 0.2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p = { x: a.x + d.x * t, z: a.z + d.z * t };
    for (const o of OBSTACLES) {
      if (o.kind === 'circle') {
        if (dist(p, o) < o.r + r) return false;
      } else {
        if (Math.abs(p.x - o.x) < o.hw + r && Math.abs(p.z - o.z) < o.hd + r) return false;
      }
    }
  }
  return true;
}
