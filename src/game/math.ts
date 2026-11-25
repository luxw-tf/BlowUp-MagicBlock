import type { Vec2 } from './types';

export const v = (x = 0, z = 0): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 1e-6 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
};
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const isFiniteVec = (a: Vec2 | undefined): a is Vec2 =>
  !!a && Number.isFinite(a.x) && Number.isFinite(a.z);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
