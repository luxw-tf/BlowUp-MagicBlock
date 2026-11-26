/**
 * Independently recompute every VRF-derived draw of a match from the raw
 * randomness in its callback transactions, and compare with what the program
 * logged. Mirrors programs/blowup/src/{lib.rs draw_u32, rules.rs}.
 *
 * Works for any seat count (quick play or private rooms) and long matches.
 * Usage: npx tsx verify-draws.ts <report.json | matchPda> [erUrl]
 */
import { utils } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_BASE_RPC as BASE_RPC, decodeMatch } from '../src/chain/program';

const PID = '915f4aBTkrJaZ4ym6D85AoNLHQwazUC3vmbjgQNyhyob';
// Must match programs/blowup/src/rules.rs (FUSE_RANGES_MS, OPENING_FUSE_BONUS_MS, ROUND_DEADLINE_MS).
const RANGES: Record<number, [number, number]> = { 6: [5000, 11000], 5: [4500, 10000], 4: [4000, 8500], 3: [4000, 7000], 2: [4000, 7000] };
const OPENING_FUSE_BONUS_MS = 1500;
const ROUND_DEADLINE_MS = 45000;

const arg = process.argv[2];
let matchPda: string;
let erUrl = process.argv[3] ?? 'https://devnet-as.magicblock.app/';
if (existsSync(arg)) {
  const r = JSON.parse(readFileSync(arg, 'utf8'));
  matchPda = r.match.pda;
  erUrl = r.validator?.fqdn ?? erUrl;
} else matchPda = arg;

const draw = (rnd: Buffer, tag: string) =>
  createHash('sha256').update('blowup').update(tag).update(rnd).digest().readUInt32LE(0);
const pick = (u: number, n: number) => Number((BigInt(u) * BigInt(n)) >> 32n);
/** Uncompressed fuse at round start (elapsed 0); later fuses depend on elapsed slots. */
const fuseAtStart = (survivors: number, u: number) => {
  const [lo, hi] = RANGES[survivors];
  // Opening fuse: drawn fuse + opening bonus, capped by the full round (elapsed 0).
  return Math.min(lo + Number((BigInt(hi - lo) * BigInt(u)) >> 32n) + OPENING_FUSE_BONUS_MS, ROUND_DEADLINE_MS);
};

const er = new Connection(erUrl, 'confirmed');
const matchKey = new PublicKey(matchPda);

// Who was alive in each round comes from the match's final placements: a
// player with placement k was eliminated when k players remained (1 = winner,
// 0 = no seat). Read the settled account on Solana, else the ER copy.
const placements = await (async () => {
  for (const conn of [new Connection(BASE_RPC, 'confirmed'), er]) {
    const info = await conn.getAccountInfo(matchKey).catch(() => null);
    if (info?.owner.toBase58() === PID) return decodeMatch(info.data).placements;
  }
  throw new Error('match account not readable (still delegated and ER unreachable?)');
})();
const seats = placements.filter((p) => p > 0).length;
const aliveInRound = (round: number) => {
  const n = seats - round + 1;
  return placements.map((p, i) => (p > 0 && p <= n ? i : -1)).filter((i) => i >= 0);
};

// Full history, oldest first: matches have thousands of transactions (every
// position input touches the match account), so page past the 1,000 limit.
const sigs: string[] = [];
for (let before: string | undefined; ; ) {
  const page = await er.getSignaturesForAddress(matchKey, { limit: 1000, before });
  sigs.push(...page.filter((s) => !s.err).map((s) => s.signature));
  if (page.length < 1000) break;
  before = page[page.length - 1].signature;
}
sigs.reverse();
console.log(`${sigs.length} transactions, ${seats} seats, placements ${JSON.stringify(placements)}`);

let ok = 0;
let bad = 0;
const holderU: number[] = [];
const fuseU: number[] = [];
const txs: Awaited<ReturnType<typeof er.getTransactions>> = [];
for (let i = 0; i < sigs.length; i += 100) {
  txs.push(...(await er.getTransactions(sigs.slice(i, i + 100), { maxSupportedTransactionVersion: 1 })));
}
for (const tx of txs) {
  const logs = tx?.meta?.logMessages ?? [];
  if (!logs.some((l) => l.includes('Instruction: CallbackRandomness'))) continue;
  const keys = tx!.transaction.message.staticAccountKeys;
  for (const inner of tx!.meta!.innerInstructions ?? [])
    for (const ii of inner.instructions) {
      if (keys[ii.programIdIndex]?.toBase58() !== PID) continue;
      const d = Buffer.from(utils.bytes.bs58.decode(ii.data as unknown as string));
      const rnd = d.subarray(8, 40);
      const holderLog = logs.map((l) => /round (\d+) holder (\d+) fuse (\d+)ms/.exec(l)).find(Boolean);
      const fuseLog = logs.map((l) => /fuse (\d+)ms for holder/.exec(l)).find(Boolean);
      if (holderLog) {
        const uh = draw(rnd, 'holder');
        const uf = draw(rnd, 'holder-fuse');
        holderU.push(uh / 2 ** 32);
        const alive = aliveInRound(Number(holderLog[1]));
        const expHolder = alive[pick(uh, alive.length)];
        const expFuse = fuseAtStart(alive.length, uf);
        const good = expHolder === Number(holderLog[2]) && expFuse === Number(holderLog[3]);
        good ? ok++ : bad++;
        console.log(`${good ? 'OK ' : 'BAD'} round ${holderLog[1]}: alive [${alive}] → holder ${expHolder} (logged ${holderLog[2]}), fuse ${expFuse}ms (logged ${holderLog[3]})`);
      } else if (fuseLog) {
        fuseU.push(draw(rnd, 'fuse') / 2 ** 32);
      }
    }
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(`\nholder draws: ${holderU.map((u) => u.toFixed(2)).join(' ')} (mean ${mean(holderU).toFixed(3)})`);
console.log(`fuse draws:   ${fuseU.map((u) => u.toFixed(2)).join(' ')} (mean ${mean(fuseU).toFixed(3)})`);
console.log(`${ok} holder draws reproduced, ${bad} mismatched`);
process.exitCode = bad ? 1 : 0;
