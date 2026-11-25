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

export const OBSTACLES: Obstacle[] = [
  // Central water basin: blocks movement and projectiles.
  { kind: 'circle', x: 0, z: 0, r: 2.8, tag: 'basin' },
  // Side crates for juking.
  { kind: 'box', x: -8, z: -4.2, hw: 0.9, hd: 0.9, tag: 'crate' },
  { kind: 'box', x: 8, z: -4.2, hw: 0.9, hd: 0.9, tag: 'crate' },
  { kind: 'box', x: -8, z: 4.2, hw: 0.9, hd: 0.9, tag: 'crate' },
  { kind: 'box', x: 8, z: 4.2, hw: 0.9, hd: 0.9, tag: 'crate' },
  { kind: 'box', x: -13.6, z: 0, hw: 0.7, hd: 1.4, tag: 'crate' },
  { kind: 'box', x: 13.6, z: 0, hw: 0.7, hd: 1.4, tag: 'crate' },
];

export const SPAWNS: Vec2[] = [
  { x: -12, z: -6 },
  { x: 0, z: -6.5 },
  { x: 12, z: -6 },
  { x: 12, z: 6 },
  { x: 0, z: 6.5 },
  { x: -12, z: 6 },
];

export const PICKUP_SPOTS: Vec2[] = [
  { x: -5.5, z: 0 },
  { x: 5.5, z: 0 },
  { x: -16, z: -7.5 },
  { x: 16, z: 7.5 },
];

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
