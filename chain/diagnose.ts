/**
 * Diagnostics for a feasibility run: ER transaction logs for a match account
 * and ER Clock sysvar vs wall-clock.
 * Usage: npx tsx diagnose.ts <matchPda> [erUrl]
 */
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';

const match = new PublicKey(process.argv[2]);
const erUrl = process.argv[3] ?? 'https://devnet-as.magicblock.app/';
const er = new Connection(erUrl, 'confirmed');

async function clock() {
  const info = await er.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  if (!info) return console.log('no clock sysvar on ER');
  const d = info.data;
  const slot = d.readBigUInt64LE(0);
  const unix = Number(d.readBigInt64LE(32));
  const wall = Math.floor(Date.now() / 1000);
  console.log(`ER clock: slot ${slot} unix ${unix} (${new Date(unix * 1000).toISOString()}) wall ${wall} → drift ${unix - wall}s`);
  console.log('ER getSlot', await er.getSlot());
}

async function logs() {
  const sigs = await er.getSignaturesForAddress(match, { limit: 40 });
  console.log(`${sigs.length} signatures for ${match.toBase58()}`);
  for (const s of sigs.slice(0, 40).reverse()) {
    const tx = await er.getTransaction(s.signature, { maxSupportedTransactionVersion: 1 });
    const lines = (tx?.meta?.logMessages ?? []).filter(
      (l) => /Instruction:|Program log|failed|error|consumed|invoke \[/.test(l) && !/consumed/.test(l),
    );
    const ix = lines.find((l) => l.includes('Instruction:')) ?? '';
    if (/SubmitInput/.test(ix)) continue;
    console.log(`\n${s.signature.slice(0, 16)}… slot ${s.slot} err=${JSON.stringify(s.err)}`);
    for (const l of lines.slice(0, 14)) console.log('   ', l.slice(0, 180));
  }
}

await clock();
await logs();
