/**
 * The bomb rules live in two places: the on-chain program
 * (programs/blowup/src/rules.rs) and the client's offline simulation / online
 * mirror (src/game/config.ts). This test reads the Rust source and fails if a
 * shared constant drifts, so a tuning change can't land on one side only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';

const rust = readFileSync(new URL('../../programs/blowup/src/rules.rs', import.meta.url), 'utf8');

/** `pub const NAME: type = 1_234;` → 1234 */
function constant(name: string): number {
  const m = new RegExp(`pub const ${name}: \\w+ = ([0-9_]+);`).exec(rust);
  if (!m) throw new Error(`${name} not found in rules.rs`);
  return Number(m[1].replace(/_/g, ''));
}

/** FUSE_RANGES_MS tuples, indexed by survivors (entries 0 and 1 unused). */
function fuseRangesMs(): [number, number][] {
  const block = /pub const FUSE_RANGES_MS[^=]*= \[([\s\S]*?)\];/.exec(rust)?.[1];
  if (!block) throw new Error('FUSE_RANGES_MS not found in rules.rs');
  return [...block.matchAll(/\(([0-9_]+),\s*([0-9_]+)\)/g)].map((t) => [Number(t[1].replace(/_/g, '')), Number(t[2].replace(/_/g, ''))]);
}

const seconds = (ms: number) => ms / 1000;

describe('client rules match the on-chain program', () => {
  it('fuse ranges per survivor count', () => {
    const chain = fuseRangesMs();
    for (const survivors of [2, 3, 4, 5, 6]) {
      const [lo, hi] = chain[survivors];
      expect(CONFIG.fuseRanges[survivors], `${survivors} survivors`).toEqual([seconds(lo), seconds(hi)]);
    }
  });

  it('fuse timing constants', () => {
    expect(CONFIG.fuseMinimum).toBe(seconds(constant('FUSE_MIN_MS')));
    expect(CONFIG.compressionWindow).toBe(seconds(constant('COMPRESSION_WINDOW_MS')));
    expect(CONFIG.compressionFloor).toBe(constant('COMPRESSION_FLOOR_PERMILLE') / 1000);
    expect(CONFIG.roundHardDeadline).toBe(seconds(constant('ROUND_DEADLINE_MS')));
    expect(CONFIG.openingFuseBonus).toBe(seconds(constant('OPENING_FUSE_BONUS_MS')));
  });

  it('transfer rules', () => {
    expect(CONFIG.transferProtection).toBe(seconds(constant('TRANSFER_PROTECTION_MS')));
    expect(CONFIG.tagRange).toBe(constant('TAG_RANGE_MM') / 1000);
    expect(CONFIG.throwRange).toBe(constant('THROW_RANGE_MM') / 1000);
  });
});
