/**
 * PRD Phase 00 feasibility harness.
 *
 * Runs one complete match of the `blowup` program on Solana devnet + a
 * MagicBlock Ephemeral Rollup and measures what the PRD lists as unvalidated:
 *   - delegation and live ER updates (input confirmation + subscription latency)
 *   - VRF fulfilment latency (holder draw and fuse draws)
 *   - guest sponsorship (can an unfunded guest key send ER transactions?)
 *   - session expiry + renewal, invalid-input rejection
 *   - commit/undelegate and durable result on Solana
 *
 * Usage:  npm run feasibility            (from chain/)
 * Env:    SOLANA_RPC, ROUTER_RPC, ER_VALIDATOR (identity pubkey), PLAYERS (2-6)
 */
import * as anchor from '@coral-xyz/anchor';
import { ConnectionMagicRouter, GetCommitmentSignature } from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
} from '@solana/web3.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOLANA_RPC = process.env.SOLANA_RPC ?? 'https://rpc.magicblock.app/devnet';
const ROUTER_RPC = process.env.ROUTER_RPC ?? 'https://devnet-router.magicblock.app';
const PLAYERS = Math.min(6, Math.max(2, Number(process.env.PLAYERS ?? 6)));
const EPHEMERAL_QUEUE = new PublicKey('5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc');
const SPAWNS: [number, number][] = [
  [-12_000, -6_000],
  [0, -6_500],
  [12_000, -6_000],
  [12_000, 6_000],
  [0, 6_500],
  [-12_000, 6_000],
];

// ───────────────────────── setup ─────────────────────────

function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  mkdirSync(dirname(path), { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const idlPath = [join(ROOT, 'target/idl/blowup.json'), join(ROOT, 'chain/idl/blowup.json')].find(existsSync) ?? 'target/idl/blowup.json';
if (!existsSync(idlPath)) throw new Error(`IDL not found at ${idlPath} — run \`anchor build\` first`);
const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as anchor.Idl;
const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
const ERRORS = new Map<number, string>(((idl as { errors?: { code: number; name: string }[] }).errors ?? []).map((e) => [e.code, e.name]));

const authority = loadOrCreateKeypair(join(ROOT, '.keys/authority.json'));
const base = new Connection(SOLANA_RPC, 'confirmed');
const router = new ConnectionMagicRouter(ROUTER_RPC, { commitment: 'confirmed' });
const program = new anchor.Program(idl, new anchor.AnchorProvider(base, new anchor.Wallet(authority), { commitment: 'confirmed' }));

const matchPda = (id: anchor.BN) =>
  PublicKey.findProgramAddressSync([Buffer.from('match'), id.toArrayLike(Buffer, 'le', 8)], PROGRAM_ID)[0];
const playerPda = (m: PublicKey, i: number) =>
  PublicKey.findProgramAddressSync([Buffer.from('player'), m.toBuffer(), Buffer.from([i])], PROGRAM_ID)[0];
const resultPda = (m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('result'), m.toBuffer()], PROGRAM_ID)[0];

function decode<T = any>(name: string, data: Buffer): T {
  return program.coder.accounts.decode(name, data) as T;
}

// ───────────────────────── measurement helpers ─────────────────────────

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: Math.round(pct(xs, 50)),
  p95: Math.round(pct(xs, 95)),
  p99: Math.round(pct(xs, 99)),
  max: Math.round(Math.max(...xs, 0)),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

interface SendResult {
  sig: string;
  ms: number;
  err: string | null;
}

function explainErr(err: unknown): string | null {
  if (!err) return null;
  const ie = (err as { InstructionError?: [number, unknown] }).InstructionError;
  const custom = ie && (ie[1] as { Custom?: number }).Custom;
  if (typeof custom === 'number') return ERRORS.get(custom) ?? `Custom(${custom})`;
  return JSON.stringify(err);
}

let blockhashCache: { conn: Connection; hash: string; at: number } | null = null;
async function blockhash(conn: Connection): Promise<string> {
  if (blockhashCache && blockhashCache.conn === conn && now() - blockhashCache.at < 2_000) return blockhashCache.hash;
  const { blockhash: hash } = await conn.getLatestBlockhash();
  blockhashCache = { conn, hash, at: now() };
  return hash;
}

/** Send and poll until processed. On the ER preflight doesn't simulate, so status errors are the truth. */
async function send(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[], feePayer: Keypair, timeoutMs = 15_000): Promise<SendResult> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer.publicKey;
  tx.recentBlockhash = await blockhash(conn);
  const uniq = [feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey))];
  tx.sign(...uniq);
  const t0 = now();
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  } catch (e) {
    return { sig: '', ms: now() - t0, err: `send failed: ${(e as Error).message.slice(0, 200)}` };
  }
  // ER: poll tightly to measure latency. Base layer: be gentle with public RPC limits.
  const interval = conn === base ? 500 : 10;
  while (now() - t0 < timeoutMs) {
    let st;
    try {
      st = (await conn.getSignatureStatuses([sig])).value[0];
    } catch {
      await sleep(Math.max(interval, 250)); // transient RPC error / rate limit
      continue;
    }
    if (st && (st.confirmationStatus || st.err)) return { sig, ms: now() - t0, err: explainErr(st.err) };
    await sleep(interval);
  }
  return { sig, ms: now() - t0, err: 'timeout' };
}

/** Resolves when the account satisfies `pred`, using an ER websocket subscription. */
function waitForAccount<T>(conn: Connection, key: PublicKey, name: string, pred: (s: T) => boolean, timeoutMs = 20_000): Promise<{ ms: number; state: T }> {
  const t0 = now();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (state: T) => {
      if (done) return;
      done = true;
      conn.removeAccountChangeListener(id).catch(() => {});
      clearTimeout(timer);
      clearInterval(poll);
      resolve({ ms: now() - t0, state });
    };
    const check = (info: AccountInfo<Buffer> | null) => {
      if (!info) return;
      const s = decode<T>(name, info.data);
      if (pred(s)) finish(s);
    };
    const id = conn.onAccountChange(key, check, { commitment: 'processed' });
    // Belt and braces: slow poll in case a websocket update is missed.
    const poll = setInterval(() => conn.getAccountInfo(key, 'processed').then(check).catch(() => {}), 250);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      conn.removeAccountChangeListener(id).catch(() => {});
      clearInterval(poll);
      reject(new Error(`timeout waiting for ${name} ${key.toBase58()}`));
    }, timeoutMs);
  });
}

// ───────────────────────── report ─────────────────────────

const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  solanaRpc: SOLANA_RPC,
  router: ROUTER_RPC,
  programId: PROGRAM_ID.toBase58(),
  players: PLAYERS,
  checks: [] as { name: string; pass: boolean; detail: string }[],
};
const check = (name: string, pass: boolean, detail = '') => {
  (report.checks as { name: string; pass: boolean; detail: string }[]).push({ name, pass, detail });
  log(pass ? 'PASS' : 'FAIL', name, detail);
};

// ───────────────────────── main ─────────────────────────

async function main() {
  log('authority', authority.publicKey.toBase58());
  const bal = await base.getBalance(authority.publicKey);
  log('authority balance', bal / LAMPORTS_PER_SOL, 'SOL');
  if (bal < 0.5 * LAMPORTS_PER_SOL) {
    log('requesting devnet airdrop…');
    try {
      const sig = await base.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL);
      await base.confirmTransaction(sig, 'confirmed');
    } catch (e) {
      throw new Error(
        `Airdrop failed (${(e as Error).message}). Fund ${authority.publicKey.toBase58()} via https://faucet.solana.com and rerun.`,
      );
    }
  }
  const programInfo = await base.getAccountInfo(PROGRAM_ID);
  if (!programInfo?.executable) throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on ${SOLANA_RPC}`);

  // Pick the ER validator.
  const closest = await router.getClosestValidator();
  const validator = new PublicKey(process.env.ER_VALIDATOR ?? closest.identity);
  log('validator', validator.toBase58(), closest.fqdn ?? '');
  const routes = await fetch(ROUTER_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getRoutes', params: [] }),
  })
    .then((r) => r.json())
    .catch(() => null);
  const route = (routes?.result as { identity: string; fqdn: string; blockTimeMs?: number }[] | undefined)?.find(
    (r) => r.identity === validator.toBase58(),
  );
  const slotMs = Math.round(route?.blockTimeMs ?? 50);
  report.validator = { identity: validator.toBase58(), fqdn: route?.fqdn ?? closest.fqdn, nominalBlockTimeMs: slotMs };

  // Guests: identity + separate session key; neither is funded.
  const matchId = new anchor.BN(Date.now());
  const match = matchPda(matchId);
  const guests = Array.from({ length: PLAYERS }, () => ({ identity: Keypair.generate(), session: Keypair.generate() }));
  const nowSec = Math.floor(Date.now() / 1000);
  // Player 1's session expires early to exercise expiry + renewal.
  const SHORT_SESSION_S = 45;
  report.match = { id: matchId.toString(), pda: match.toBase58() };
  log('match', match.toBase58());

  // ── base layer: create, join (sponsored), delegate ──
  let t = now();
  const createIx = await program.methods.createMatch(matchId, slotMs).accountsPartial({ authority: authority.publicKey, matchState: match }).instruction();
  const joinIxs = await Promise.all(
    guests.map((g, i) =>
      program.methods
        .joinMatch(i, g.identity.publicKey, g.session.publicKey, new anchor.BN(nowSec + (i === 1 ? SHORT_SESSION_S : 3_600)))
        .accountsPartial({ authority: authority.publicKey, matchState: match, playerState: playerPda(match, i) })
        .instruction(),
    ),
  );
  let r = await send(base, [createIx, ...joinIxs.slice(0, 3)], [], authority, 60_000);
  if (r.err) throw new Error(`create/join failed: ${r.err} ${r.sig}`);
  if (joinIxs.length > 3) {
    r = await send(base, joinIxs.slice(3), [], authority, 60_000);
    if (r.err) throw new Error(`join failed: ${r.err} ${r.sig}`);
  }
  report.baseSetupMs = Math.round(now() - t);

  const validatorMeta = { pubkey: validator, isSigner: false, isWritable: false };
  t = now();
  const delegateIxs = [
    ...(await Promise.all(
      guests.map((_, i) =>
        program.methods
          .delegatePlayer(i)
          .accountsPartial({ payer: authority.publicKey, matchState: match, playerState: playerPda(match, i) })
          .remainingAccounts([validatorMeta])
          .instruction(),
      ),
    )),
  ];
  for (let i = 0; i < delegateIxs.length; i += 2) {
    r = await send(base, delegateIxs.slice(i, i + 2), [], authority, 60_000);
    if (r.err) throw new Error(`delegate player failed: ${r.err} ${r.sig}`);
  }
  r = await send(
    base,
    [await program.methods.delegateMatch(matchId).accountsPartial({ payer: authority.publicKey, matchState: match }).remainingAccounts([validatorMeta]).instruction()],
    [],
    authority,
    60_000,
  );
  if (r.err) throw new Error(`delegate match failed: ${r.err} ${r.sig}`);
  const delegateConfirmedMs = now() - t;

  // Router visibility.
  let status: { isDelegated: boolean; fqdn?: string } = { isDelegated: false };
  const tRouter = now();
  while (now() - tRouter < 30_000) {
    status = (await router.getDelegationStatus(match)) as typeof status;
    if (status.isDelegated) break;
    await sleep(200);
  }
  check('delegation visible via router', status.isDelegated, `${Math.round(now() - tRouter)}ms after confirmation`);
  report.delegation = { baseConfirmMs: Math.round(delegateConfirmedMs), routerVisibleMs: Math.round(now() - tRouter) };
  const erUrl = status.fqdn ?? route?.fqdn ?? closest.fqdn;
  if (!erUrl) throw new Error('No ER endpoint resolved');
  const er = new Connection(erUrl, { commitment: 'processed', wsEndpoint: erUrl.replace(/^http/, 'ws') });
  blockhashCache = null;
  log('ER endpoint', erUrl);
  const erVersion = await er.getVersion().catch(() => null);
  report.erVersion = erVersion;

  // Wait until the ER has cloned our accounts.
  await waitForAccount(er, match, 'matchState', () => true, 30_000);

  const ix = {
    input: (i: number, seq: number, x: number, z: number, signer = guests[i].session.publicKey) =>
      program.methods.submitInput(seq, x, z).accountsPartial({ signer, matchState: match, playerState: playerPda(match, i) }).instruction(),
  };

  // ── sponsorship: can an unfunded guest session key pay ER fees? ──
  const seqs = guests.map(() => 0);
  const pos = SPAWNS.slice(0, PLAYERS).map(([x, z]) => ({ x, z }));
  r = await send(er, [await ix.input(0, ++seqs[0], pos[0].x + 100, pos[0].z)], [guests[0].session], guests[0].session);
  const unfundedOk = !r.err;
  if (unfundedOk) pos[0].x += 100;
  else seqs[0]--;
  check('unfunded guest key can pay its own ER transactions', unfundedOk, r.err ?? `${Math.round(r.ms)}ms`);
  // Fallback: lobby authority as fee payer, guest key signs the instruction.
  const feePayerFor = (i: number) => (unfundedOk ? guests[i].session : authority);
  if (!unfundedOk) {
    r = await send(er, [await ix.input(0, ++seqs[0], pos[0].x + 100, pos[0].z)], [guests[0].session], authority);
    check('sponsored ER transaction (authority fee payer, guest signer)', !r.err, r.err ?? `${Math.round(r.ms)}ms`);
    if (!r.err) pos[0].x += 100;
  }
  report.sponsorship = { unfundedGuestCanPay: unfundedOk };

  // ── live ER updates: 20 Hz inputs from every player ──
  log(`input burst: ${PLAYERS} players × 20 Hz × 5 s`);
  const confirmMs: number[] = [];
  const visibleMs: number[] = [];
  let inputErrors = 0;
  const errorReasons: Record<string, number> = {};
  const watched = playerPda(match, 0);
  const pendingVisible = new Map<number, number>(); // seq → sent time
  const sub = er.onAccountChange(
    watched,
    (info) => {
      const p = decode<{ seq: number }>('playerState', info.data);
      const sent = pendingVisible.get(p.seq);
      if (sent !== undefined) {
        visibleMs.push(now() - sent);
        pendingVisible.delete(p.seq);
      }
    },
    { commitment: 'processed' },
  );
  const slot0 = await er.getSlot('processed');
  const tSlot0 = now();
  const jobs: Promise<void>[] = [];
  for (let tick = 0; tick < 100; tick++) {
    for (let i = 0; i < PLAYERS; i++) {
      const dir = tick % 20 < 10 ? 1 : -1;
      pos[i].x += 250 * dir; // 5 u/s
      const seq = ++seqs[i];
      const { x, z } = pos[i];
      jobs.push(
        (async () => {
          if (i === 0) pendingVisible.set(seq, now());
          const res = await send(er, [await ix.input(i, seq, x, z)], [guests[i].session], feePayerFor(i));
          if (res.err) {
            inputErrors++;
            errorReasons[res.err] = (errorReasons[res.err] ?? 0) + 1;
          } else confirmMs.push(res.ms);
        })(),
      );
    }
    await sleep(50);
  }
  await Promise.all(jobs);
  await sleep(500);
  await er.removeAccountChangeListener(sub);
  const slot1 = await er.getSlot('processed');
  const measuredSlotMs = (now() - tSlot0) / Math.max(1, slot1 - slot0);
  report.inputs = {
    sent: 100 * PLAYERS,
    errors: inputErrors,
    errorReasons,
    confirm: stats(confirmMs),
    subscriptionVisible: stats(visibleMs),
  };
  report.slotTiming = { nominalMs: slotMs, measuredMs: Math.round(measuredSlotMs * 10) / 10 };
  check('ER input confirmation p95 < 100ms (PRD target)', pct(confirmMs, 95) < 100, JSON.stringify(stats(confirmMs)));
  // Inputs are independent transactions carrying absolute positions, so a late
  // arrival behind a newer seq is correctly dropped (StaleSequence) and loses
  // nothing. Anything else is a real failure.
  const unexpected = inputErrors - (errorReasons.StaleSequence ?? 0);
  report.inputs = { ...(report.inputs as object), reorderedDroppedPct: Math.round(((errorReasons.StaleSequence ?? 0) / (100 * PLAYERS)) * 1000) / 10 };
  check('no input errors other than reordering', unexpected === 0, `${unexpected} unexpected ${JSON.stringify(errorReasons)}`);

  /** Re-read authoritative seq/position so one test can't poison the next. */
  const sync = async (i: number) => {
    const p = decode<{ x: number; z: number; seq: number }>('playerState', (await er.getAccountInfo(playerPda(match, i), 'processed'))!.data);
    pos[i] = { x: p.x, z: p.z };
    seqs[i] = p.seq;
  };
  await Promise.all(guests.map((_, i) => sync(i)));

  // ── invalid inputs are rejected ──
  const expectErr = async (name: string, expected: string, ixs: TransactionInstruction[], signers: Keypair[], payer: Keypair) => {
    const res = await send(er, ixs, signers, payer);
    check(`rejects ${name}`, res.err === expected, `got ${res.err ?? 'success'}`);
  };
  await sleep(1_500); // idle first: the teleport must be rejected even after banking time
  await sync(0);
  await expectErr('duplicate sequence', 'StaleSequence', [await ix.input(0, seqs[0], pos[0].x, pos[0].z)], [guests[0].session], feePayerFor(0));
  await sync(0);
  await expectErr('teleport after idling', 'ImpossibleMovement', [await ix.input(0, seqs[0] + 1, pos[0].x + 15_000, pos[0].z)], [guests[0].session], feePayerFor(0));
  await sync(0);
  await expectErr('out of bounds', 'OutOfBounds', [await ix.input(0, seqs[0] + 1, 25_000, 0)], [guests[0].session], feePayerFor(0));
  await sync(0);
  await expectErr(
    'foreign signer',
    'NotSessionKey',
    [await ix.input(0, seqs[0] + 1, pos[0].x, pos[0].z, guests[2].session.publicKey)],
    [guests[2].session],
    feePayerFor(2),
  );

  // ── session expiry and renewal (no wallet) ──
  // Expiry is judged by the ER's Clock sysvar, which may be offset from wall time.
  const erUnix = async () => Number((await er.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'processed'))!.data.readBigInt64LE(32));
  report.erClockSkewS = (await erUnix()) - Math.floor(Date.now() / 1000);
  const expiry = nowSec + SHORT_SESSION_S;
  log(`ER clock skew ${report.erClockSkewS}s; waiting for player 1's session to expire on the ER…`);
  while ((await erUnix()) <= expiry + 1) await sleep(1_000);
  await sync(1);
  await expectErr('expired session', 'SessionExpired', [await ix.input(1, seqs[1] + 1, pos[1].x, pos[1].z)], [guests[1].session], feePayerFor(1));
  await sync(1);
  const newSession = Keypair.generate();
  r = await send(
    er,
    [
      await program.methods
        .renewSession(newSession.publicKey, new anchor.BN(Math.floor(Date.now() / 1000) + 3_600))
        .accountsPartial({ authority: guests[1].identity.publicKey, playerState: playerPda(match, 1) })
        .instruction(),
    ],
    [guests[1].identity],
    unfundedOk ? guests[1].identity : authority,
  );
  check('guest renews its own session', !r.err, r.err ?? '');
  guests[1].session = newSession;
  r = await send(er, [await ix.input(1, ++seqs[1], pos[1].x, pos[1].z)], [newSession], unfundedOk ? newSession : authority);
  check('renewed session accepted', !r.err, r.err ?? '');

  // ── match: VRF holder draw, transfers (VRF fuse), eliminations ──
  const holderVrfMs: number[] = [];
  const fuseVrfMs: number[] = [];
  let retries = 0;
  const seed = () => Array.from(crypto.getRandomValues(new Uint8Array(8)));
  type M = {
    phase: number;
    holder: number;
    aliveMask: number;
    fuseDeadlineSlot: anchor.BN;
    roundDeadlineSlot: anchor.BN;
    vrfNonce: number;
    vrfPurpose: number;
    round: number;
    winner: number;
    fuseMs: number;
    protectedPlayer: number;
    protectedUntilSlot: anchor.BN;
  };
  const getMatch = async () => decode<M>('matchState', (await er.getAccountInfo(match, 'processed'))!.data);
  const requestAccounts = { payer: authority.publicKey, matchState: match, oracleQueue: EPHEMERAL_QUEUE };

  /** Waits for a VRF callback; retries the request on a bounded timeout. */
  const awaitVrf = async (pred: (m: M) => boolean, sentAt: number, sink: number[]) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await waitForAccount<M>(er, match, 'matchState', pred, 8_000);
        sink.push(now() - sentAt);
        return res.state;
      } catch {
        retries++;
        log('VRF slow — retrying request');
        const rr = await send(er, [await program.methods.retryRandomness(seed()).accountsPartial(requestAccounts).instruction()], [], authority);
        if (rr.err) log('retry failed:', rr.err);
        sentAt = now();
      }
    }
    throw new Error('VRF did not fulfil after retries');
  };

  let tReq = now();
  r = await send(er, [await program.methods.startMatch(seed()).accountsPartial(requestAccounts).instruction()], [], authority);
  if (r.err) throw new Error(`start_match failed: ${r.err} ${r.sig}`);
  let m = await awaitVrf((s) => s.phase === 2, tReq, holderVrfMs);
  log(`round ${m.round}: holder ${m.holder}, fuse ${m.fuseMs}ms`);

  const transferIx = (from: number, to: number, method: number) =>
    program.methods
      .transfer(to, method, seed())
      .accountsPartial({
        payer: guests[from].session.publicKey,
        matchState: match,
        holderState: playerPda(match, from),
        targetState: playerPda(match, to),
        oracleQueue: EPHEMERAL_QUEUE,
      })
      .instruction();

  /** Walk player i to (x, z) with plausible 20 Hz steps. */
  const walkTo = async (i: number, x: number, z: number) => {
    while (Math.hypot(x - pos[i].x, z - pos[i].z) > 50) {
      const dx = x - pos[i].x;
      const dz = z - pos[i].z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, 900);
      pos[i] = { x: Math.round(pos[i].x + (dx / d) * step), z: Math.round(pos[i].z + (dz / d) * step) };
      const res = await send(er, [await ix.input(i, ++seqs[i], pos[i].x, pos[i].z)], [guests[i].session], feePayerFor(i));
      if (res.err) throw new Error(`walk input rejected: ${res.err}`);
    }
  };

  let firstTransferChecks = true;
  let precedenceChecked = false;
  while (m.phase !== 3) {
    const alive = guests.map((_, i) => i).filter((i) => m.aliveMask & (1 << i));
    // One or two transfers per round, then let the fuse run out.
    for (let k = 0; k < 2 && m.phase === 2; k++) {
      const from = m.holder;
      const candidates = alive.filter((i) => i !== from && !(m.protectedPlayer === i));
      if (candidates.length === 0) break; // final duel: the only target is still protected
      const to = candidates[Math.floor(Math.random() * candidates.length)];
      // Meet in the middle of the arena edge lane to stay clear of obstacles.
      await walkTo(to, Math.max(-16_000, Math.min(16_000, pos[from].x + 1_000)), pos[from].z);
      m = await getMatch();
      if (m.phase !== 2 || m.holder !== from || m.fuseDeadlineSlot.isZero()) break;
      const slotNow = await er.getSlot('processed');
      if (slotNow + 10 >= m.fuseDeadlineSlot.toNumber()) break; // too close to expiry to try
      if (firstTransferChecks) {
        await expectErr('transfer by non-holder', 'NotHolder', [await transferIx(to, from, 0)], [guests[to].session], feePayerFor(to));
      }
      tReq = now();
      r = await send(er, [await transferIx(from, to, 0)], [guests[from].session], feePayerFor(from));
      if (r.err) {
        log('transfer rejected:', r.err);
        break;
      }
      if (firstTransferChecks) {
        // New holder immediately tags back: blocked by arming (VRF pending) or transfer protection.
        const back = await send(er, [await transferIx(to, from, 0)], [guests[to].session], feePayerFor(to));
        check('immediate tag-back rejected', back.err === 'FuseArming' || back.err === 'TargetProtected', `got ${back.err ?? 'success'}`);
        firstTransferChecks = false;
      }
      m = await awaitVrf((s) => s.phase !== 2 || !s.fuseDeadlineSlot.isZero(), tReq, fuseVrfMs);
      log(`  ${from} → ${to}, new fuse ${m.fuseMs}ms`);
    }

    // Let the fuse expire, then crank the elimination.
    if (m.phase === 2) {
      const deadline = Math.min(m.fuseDeadlineSlot.toNumber() || Infinity, m.roundDeadlineSlot.toNumber());
      while ((await er.getSlot('processed')) < deadline) await sleep(100);
      if (!precedenceChecked) {
        const to = alive.find((i) => i !== m.holder)!;
        await walkTo(to, Math.max(-16_000, Math.min(16_000, pos[m.holder].x + 1_000)), pos[m.holder].z);
        await expectErr('transfer after fuse expiry (expiration precedence)', 'FuseExpired', [await transferIx(m.holder, to, 0)], [guests[m.holder].session], feePayerFor(m.holder));
        precedenceChecked = true;
      }
      tReq = now();
      r = await send(er, [await program.methods.eliminate(seed()).accountsPartial(requestAccounts).instruction()], [], authority);
      if (r.err) throw new Error(`eliminate failed: ${r.err}`);
      const out = m.holder;
      m = await getMatch();
      log(`eliminated ${out}; survivors ${m.aliveMask.toString(2)}`);
      if (m.phase === 1) {
        m = await awaitVrf((s) => s.phase !== 1, tReq, holderVrfMs);
        log(`round ${m.round}: holder ${m.holder}, fuse ${m.fuseMs}ms`);
      }
    }
  }
  report.vrf = { holder: stats(holderVrfMs), fuse: stats(fuseVrfMs), retries };
  check('match finished with a winner', m.winner !== 255, `winner index ${m.winner}`);

  // ── finalize: commit + undelegate, durable result on Solana ──
  t = now();
  r = await send(
    er,
    [
      await program.methods
        .finalize()
        .accountsPartial({ payer: authority.publicKey, matchState: match })
        .remainingAccounts(guests.map((_, i) => ({ pubkey: playerPda(match, i), isSigner: false, isWritable: true })))
        .instruction(),
    ],
    [],
    authority,
  );
  if (r.err) throw new Error(`finalize failed: ${r.err} ${r.sig}`);
  const commitSig = await GetCommitmentSignature(r.sig, er);
  await base.confirmTransaction(commitSig, 'confirmed');
  let owner = (await base.getAccountInfo(match))?.owner;
  const tOwner = now();
  while (!owner?.equals(PROGRAM_ID) && now() - tOwner < 60_000) {
    await sleep(500);
    owner = (await base.getAccountInfo(match))?.owner;
  }
  const settleMs = now() - t;
  check('match undelegated back to program on Solana', !!owner?.equals(PROGRAM_ID), `${Math.round(settleMs)}ms`);

  r = await send(
    base,
    [await program.methods.recordResult().accountsPartial({ payer: authority.publicKey, matchState: match, result: resultPda(match) }).instruction()],
    [],
    authority,
    60_000,
  );
  check('result recorded on Solana', !r.err, r.err ?? r.sig);
  const res = decode<{ winner: PublicKey; placements: number[] }>('matchResult', (await base.getAccountInfo(resultPda(match)))!.data);
  check('on-chain winner matches ER state', res.winner.equals(guests[m.winner].identity.publicKey), res.winner.toBase58());
  r = await send(
    base,
    [await program.methods.recordResult().accountsPartial({ payer: authority.publicKey, matchState: match, result: resultPda(match) }).instruction()],
    [],
    authority,
    60_000,
  );
  check('settlement is idempotent (second record rejected)', !!r.err, r.err ?? 'unexpected success');
  report.settlement = { finalizeToBaseMs: Math.round(settleMs), commitSig, resultPda: resultPda(match).toBase58(), placements: res.placements };
}

main()
  .catch((e) => {
    report.fatal = (e as Error).message;
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    const dir = join(ROOT, 'chain/reports');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `feasibility-${(report.startedAt as string).replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    log('report written to', file);
    const checks = report.checks as { name: string; pass: boolean }[];
    log(`${checks.filter((c) => c.pass).length}/${checks.length} checks passed`);
    setTimeout(() => process.exit(), 500);
  });
