/**
 * Independently recompute every VRF-derived draw of a match from the raw
 * randomness in its callback transactions, and compare with what the program
 * logged. Mirrors programs/blowup/src/{lib.rs draw_u32, rules.rs}.
 *
 * Usage: npx tsx verify-draws.ts <report.json | matchPda> [erUrl]
 */
import { utils } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const PID = '915f4aBTkrJaZ4ym6D85AoNLHQwazUC3vmbjgQNyhyob';
const RANGES: Record<number, [number, number]> = { 6: [8000, 15000], 5: [6000, 12000], 4: [4000, 9000], 3: [3000, 6000], 2: [2000, 4000] };

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
  return lo + Number((BigInt(hi - lo) * BigInt(u)) >> 32n);
};

const er = new Connection(erUrl, 'confirmed');
const sigs = (await er.getSignaturesForAddress(new PublicKey(matchPda), { limit: 1000 })).filter((s) => !s.err).reverse();
let alive = [0, 1, 2, 3, 4, 5];
let ok = 0;
let bad = 0;
const holderU: number[] = [];
const fuseU: number[] = [];
for (const s of sigs) {
  const tx = await er.getTransaction(s.signature, { maxSupportedTransactionVersion: 1 });
  const logs = tx?.meta?.logMessages ?? [];
  const elim = logs.map((l) => /eliminated (\d+)/.exec(l)).find(Boolean);
  if (elim) alive = alive.filter((i) => i !== Number(elim[1]));
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
