/**
 * Runs one online match end to end on devnet + a MagicBlock ER:
 * sponsored setup → delegation → start (VRF) → bots + elimination crank →
 * finalize (commit + undelegate) → durable MatchResult on Solana.
 */
import { ConnectionMagicRouter, GetCommitmentSignature } from '@magicblock-labs/ephemeral-rollups-sdk';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { segmentClear } from '../src/game/arena';
import { BotBrain } from '../src/game/bots';
import { CONFIG } from '../src/game/config';
import { BOT_NAMES, CHARACTERS } from '../src/game/content';
import { add, dist, norm, scale, sub } from '../src/game/math';
import { holderCanAct, predictMovement, tagCandidates } from '../src/game/sim';
import type { CharacterId, PlayerState } from '../src/game/types';
import { ChainMirror, indexOf, playerId, type RosterEntry } from '../src/chain/mirror';
import {
  DEFAULT_BASE_RPC,
  DEFAULT_ROUTER,
  MAX_PLAYERS,
  PHASE,
  PROGRAM_ID,
  SlotClock,
  decodeMatch,
  decodePlayer,
  decodeResult,
  instructions,
  pda,
  sendTx,
  unitsToMm,
  watchAccount,
} from '../src/chain/program';

export type MatchStatus = 'creating' | 'delegating' | 'starting' | 'live' | 'settling' | 'finished' | 'error';

export interface HumanJoin {
  name: string;
  character: CharacterId;
  identity: PublicKey;
  session: PublicKey;
  sessionExpiry: number;
}

interface Bot {
  index: number;
  session: Keypair;
  brain: BotBrain;
  seq: number;
  lastSentAt: number;
  lastSent: { x: number; z: number } | null;
  busyUntil: number; // ms timestamp: pending transfer in flight
}

const SEND_INTERVAL_MS = 100; // position updates at 10 Hz
const TICK_MS = 50;
const MATCH_TIMEOUT_MS = 8 * 60_000;
const RANDOMNESS_RETRY_MS = 3_500;

const shuffle = <T,>(a: T[]) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let counter = 0;

export class MatchRunner {
  readonly id = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  status: MatchStatus = 'creating';
  error: string | null = null;
  readonly matchId = BigInt(Date.now()) * 100n + BigInt(counter % 100);
  readonly match = pda.match(this.matchId);
  readonly humanIndex = Math.floor(Math.random() * MAX_PLAYERS);
  roster: RosterEntry[] = [];
  erUrl: string | null = null;
  slotMs = 10;
  validator: PublicKey | null = null;
  result: Record<string, unknown> | null = null;
  readonly createdAt = Date.now();
  lastSeenAt = Date.now();

  private base: Connection;
  private router: ConnectionMagicRouter;
  private ix: ReturnType<typeof instructions>;
  private er: Connection | null = null;
  private clock: SlotClock | null = null;
  private mirror: ChainMirror | null = null;
  private bots = new Map<number, Bot>();
  private subs: (() => void)[] = [];
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastCrankAt = 0;
  private crankLagMs: number[] = [];
  private lastRetryAt = 0;
  private lastTickAt = 0;

  constructor(
    private readonly authority: Keypair,
    private readonly human: HumanJoin,
    opts: { baseRpc?: string; router?: string } = {},
  ) {
    this.base = new Connection(opts.baseRpc ?? DEFAULT_BASE_RPC, 'confirmed');
    this.router = new ConnectionMagicRouter(opts.router ?? DEFAULT_ROUTER, { commitment: 'confirmed' });
    this.ix = instructions(this.base);
  }

  private log(...a: unknown[]) {
    console.log(`[match ${this.id}]`, ...a);
  }

  publicInfo() {
    return {
      id: this.id,
      status: this.status,
      error: this.error,
      programId: PROGRAM_ID.toBase58(),
      matchId: this.matchId.toString(),
      matchPda: this.match.toBase58(),
      erUrl: this.erUrl,
      validator: this.validator?.toBase58() ?? null,
      slotMs: this.slotMs,
      roster: this.roster,
      humanIndex: this.humanIndex,
      result: this.result,
    };
  }

  async run() {
    try {
      await this.setup();
      await this.play();
      await this.settle();
      this.status = 'finished';
      this.log('finished', this.result);
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).message;
      this.log('error', e);
      this.stopLoop();
    }
  }

  // ───────────────────────── setup (base layer) ─────────────────────────

  private async setup() {
    const closest = await this.router.getClosestValidator();
    this.validator = new PublicKey(closest.identity);
    const routes = await fetch((this.router as unknown as { rpcEndpoint: string }).rpcEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getRoutes', params: [] }),
    })
      .then((r) => r.json())
      .catch(() => null);
    const route = (routes?.result as { identity: string; fqdn: string; blockTimeMs?: number }[] | undefined)?.find(
      (r) => r.identity === closest.identity,
    );
    this.slotMs = Math.max(1, Math.round(route?.blockTimeMs ?? 10));

    // Roster: the human at a random slot, bots elsewhere with distinct names/characters.
    const names = shuffle(BOT_NAMES.filter((n) => n.toLowerCase() !== this.human.name.toLowerCase()));
    const chars = shuffle(CHARACTERS.map((c) => c.id).filter((c) => c !== this.human.character));
    const now = Math.floor(Date.now() / 1000);
    const joins: { index: number; identity: PublicKey; session: PublicKey; expiry: number }[] = [];
    let b = 0;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (i === this.humanIndex) {
        this.roster.push({ index: i, name: this.human.name, character: this.human.character, isBot: false });
        joins.push({ index: i, identity: this.human.identity, session: this.human.session, expiry: this.human.sessionExpiry });
        continue;
      }
      const session = Keypair.generate();
      this.bots.set(i, { index: i, session, brain: new BotBrain(playerId(i), (Math.random() * 2 ** 31) | 0), seq: 0, lastSentAt: 0, lastSent: null, busyUntil: 0 });
      this.roster.push({ index: i, name: names[b], character: chars[b % chars.length], isBot: true });
      joins.push({ index: i, identity: Keypair.generate().publicKey, session: session.publicKey, expiry: now + 2 * 3600 });
      b++;
    }

    const auth = this.authority.publicKey;
    const joinIxs = await Promise.all(joins.map((j) => this.ix.joinMatch(auth, this.match, j.index, j.identity, j.session, j.expiry)));
    await this.base_([await this.ix.createMatch(auth, this.matchId, this.slotMs), ...joinIxs.slice(0, 3)], 'create+join');
    await this.base_(joinIxs.slice(3), 'join');

    this.status = 'delegating';
    for (let i = 0; i < MAX_PLAYERS; i += 2) {
      await this.base_(
        await Promise.all([i, i + 1].map((k) => this.ix.delegatePlayer(auth, this.match, k, this.validator!))),
        'delegate players',
      );
    }
    await this.base_([await this.ix.delegateMatch(auth, this.matchId, this.validator)], 'delegate match');

    const t0 = Date.now();
    let fqdn: string | undefined;
    while (Date.now() - t0 < 30_000) {
      const st = (await this.router.getDelegationStatus(this.match)) as { isDelegated: boolean; fqdn?: string };
      if (st.isDelegated) {
        fqdn = st.fqdn;
        break;
      }
      await sleep(250);
    }
    this.erUrl = fqdn ?? route?.fqdn ?? closest.fqdn ?? null;
    if (!this.erUrl) throw new Error('match not delegated / no ER endpoint');
    this.er = new Connection(this.erUrl, { commitment: 'processed', wsEndpoint: this.erUrl.replace(/^http/, 'ws') });
    this.clock = new SlotClock(this.er, this.slotMs);
    this.clock.start();

    // Wait for the ER to clone the match.
    for (let i = 0; i < 60 && !(await this.er.getAccountInfo(this.match, 'processed')); i++) await sleep(250);
    this.log('delegated to', this.erUrl);
  }

  private async base_(ixs: TransactionInstruction[], what: string) {
    const r = await sendTx(this.base, ixs, [], this.authority, { confirm: true, pollMs: 500, timeoutMs: 60_000 });
    if (r.err) throw new Error(`${what} failed: ${r.err} ${r.sig}`);
  }

  // ───────────────────────── play (ER) ─────────────────────────

  private async play() {
    const er = this.er!;
    const clock = this.clock!;
    const mirror = new ChainMirror(this.roster, clock, new Set(this.bots.keys()));
    this.mirror = mirror;

    this.subs.push(
      watchAccount(
        er,
        this.match,
        (data, slot) => {
          clock.observe(slot);
          for (const e of mirror.applyMatch(decodeMatch(data))) {
            if (e.type === 'elimination') this.log(`eliminated ${e.id}; ${e.survivors} left`);
            if (e.type === 'holderAssigned') this.log(`round ${e.round}: ${e.holder} holds`);
          }
        },
        { pollMs: 500 },
      ),
    );
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (this.bots.has(i)) continue; // bots are simulated here; their chain state lags ours
      this.subs.push(
        watchAccount(er, pda.player(this.match, i), (data, slot) => {
          clock.observe(slot);
          mirror.applyPlayer(decodePlayer(data));
          this.lastSeenAt = Date.now();
        }),
      );
    }
    // Give the websocket subscriptions a moment to establish before starting.
    await sleep(1_000);

    this.status = 'starting';
    const r = await sendTx(er, [await this.ix.startMatch(this.authority.publicKey, this.match)], [], this.authority, { confirm: true });
    if (r.err) throw new Error(`start_match failed: ${r.err}`);
    this.status = 'live';
    this.log('started');

    this.lastTickAt = performance.now();
    await new Promise<void>((resolve) => {
      this.loop = setInterval(() => {
        try {
          if (this.tick()) {
            this.stopLoop();
            resolve();
          }
        } catch (e) {
          this.log('tick error', e);
        }
      }, TICK_MS);
    });
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    for (const unsub of this.subs) unsub();
    this.subs = [];
    this.clock?.stop();
  }

  /** One server tick. Returns true when the match is over. */
  private tick(): boolean {
    const mirror = this.mirror!;
    const s = mirror.state;
    const m = mirror.chain;
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - this.lastTickAt) / 1000);
    this.lastTickAt = nowMs;
    s.time += dt;
    mirror.syncTimes();
    if (!m) return false;
    if (m.phase === PHASE.FINISHED) return true;
    if (Date.now() - this.createdAt > MATCH_TIMEOUT_MS) {
      this.log('timeout: aborting');
      void this.er_([this.ix.abortMatch(this.authority.publicKey, this.match)], this.authority);
      return false;
    }

    for (const bot of this.bots.values()) this.tickBot(bot, nowMs);

    // Elimination crank: permissionless on-chain; the lobby runs it promptly.
    const clock = this.clock!;
    const deadline = Math.min(m.fuseDeadlineSlot || Infinity, m.roundDeadlineSlot || Infinity);
    // Start 2 slots early and retry every 150 ms: an early attempt just fails
    // with FuseNotExpired (ER transactions are free), a late one delays play.
    if (m.phase === PHASE.ACTIVE && m.holder !== 255 && clock.now() >= deadline - 2 && nowMs - this.lastCrankAt > 150) {
      this.lastCrankAt = nowMs;
      const slotMs = m.slotMs;
      void this.er_([this.ix.eliminate(this.authority.publicKey, this.match)], this.authority).then((r) => {
        if (r && !r.err) this.crankLagMs.push(Math.max(0, (this.clock!.now() - deadline) * slotMs));
      });
    }
    // Bounded pending randomness.
    if (
      m.vrfPurpose !== 0 &&
      (clock.now() - m.vrfRequestedSlot) * m.slotMs >= RANDOMNESS_RETRY_MS &&
      nowMs - this.lastRetryAt > RANDOMNESS_RETRY_MS
    ) {
      this.lastRetryAt = nowMs;
      this.log('VRF pending too long; retrying');
      void this.er_([this.ix.retryRandomness(this.authority.publicKey, this.match)], this.authority);
    }
    return false;
  }

  private tickBot(bot: Bot, nowMs: number) {
    const s = this.mirror!.state;
    const p = s.players.find((q) => q.id === playerId(bot.index))!;
    if (!p.alive) return;
    const frame = bot.brain.decide(s);
    predictMovement(s, p, frame);

    if (nowMs >= bot.busyUntil && holderCanAct(s, p)) {
      if (frame.tag) {
        const target = tagCandidates(s, p, frame.aim)[0];
        if (target) this.botTransfer(bot, p, indexOf(target.id), 0, 0);
      } else if (frame.throw) {
        const hit = this.traceThrow(p, frame.aim);
        if (hit) this.botTransfer(bot, p, hit.index, 1, (hit.distance / CONFIG.throwSpeed) * 1000);
        else p.recoverUntil = s.time + CONFIG.missRecovery; // airball
      }
    }

    // Position updates at 10 Hz (absolute positions, validated on-chain).
    if (nowMs - bot.lastSentAt >= SEND_INTERVAL_MS) {
      const moved = !bot.lastSent || dist(bot.lastSent, p.pos) > 0.01;
      if (moved || nowMs - bot.lastSentAt > 1_000) {
        bot.lastSentAt = nowMs;
        bot.lastSent = { ...p.pos };
        const seq = ++bot.seq;
        void this.ix
          .submitInput(bot.session.publicKey, this.match, bot.index, seq, unitsToMm(p.pos.x), unitsToMm(p.pos.z))
          .then((ix) => sendTx(this.er!, [ix], [], bot.session))
          .catch(() => {});
      }
    }
  }

  /**
   * Server-side projectile trace for bot throws. Like the offline projectile,
   * targets keep moving during the flight (extrapolated along their velocity),
   * so a bot's lead aim can connect. Returns the first eligible player struck.
   */
  private traceThrow(p: PlayerState, aim: { x: number; z: number }) {
    const s = this.mirror!.state;
    const dir = norm(sub(aim, p.pos));
    const hitR = CONFIG.playerRadius + CONFIG.bombRadius;
    const flight = CONFIG.throwRange / CONFIG.throwSpeed;
    for (let t = 0.025; t <= flight; t += 0.025) {
      const bomb = add(p.pos, scale(dir, CONFIG.throwSpeed * t));
      if (!segmentClear(p.pos, bomb, CONFIG.bombRadius)) return null; // hit an obstacle
      for (const q of s.players) {
        if (!q.alive || q.id === p.id) continue;
        if (s.bomb.protectedId === q.id && s.time + t < s.bomb.protectedUntil) continue;
        const qPos = add(q.pos, scale(q.vel, t));
        if (dist(bomb, qPos) <= hitR) return { index: indexOf(q.id), distance: CONFIG.throwSpeed * t };
      }
    }
    return null;
  }

  private botTransfer(bot: Bot, p: PlayerState, target: number, method: 0 | 1, delayMs: number) {
    bot.busyUntil = performance.now() + delayMs + 400;
    p.recoverUntil = this.mirror!.state.time + (delayMs + 300) / 1000;
    setTimeout(() => {
      // Flush our latest position first so the on-chain range check sees it.
      void (async () => {
        const seq = ++bot.seq;
        const ixs = [
          await this.ix.submitInput(bot.session.publicKey, this.match, bot.index, seq, unitsToMm(p.pos.x), unitsToMm(p.pos.z)),
          await this.ix.transfer(bot.session.publicKey, this.match, bot.index, target, method),
        ];
        bot.lastSentAt = performance.now();
        bot.lastSent = { ...p.pos };
        const r = await sendTx(this.er!, ixs, [], bot.session, { confirm: true, timeoutMs: 5_000 });
        if (r.err && !/StaleSequence|ImpossibleMovement/.test(r.err)) this.log(`bot ${bot.index} → ${target} rejected: ${r.err}`);
      })().catch(() => {});
    }, delayMs);
  }

  private async er_(ixs: Promise<TransactionInstruction>[] | TransactionInstruction[], payer: Keypair) {
    try {
      const resolved = await Promise.all(ixs);
      const r = await sendTx(this.er!, resolved, [], payer, { confirm: true, timeoutMs: 5_000 });
      if (r.err && !/FuseNotExpired|WrongPhase|RetryTooEarly|NothingPending/.test(r.err)) this.log('ER tx error:', r.err);
      return r;
    } catch (e) {
      this.log('ER send error', (e as Error).message);
      return null;
    }
  }

  // ───────────────────────── settle (back to Solana) ─────────────────────────

  private async settle() {
    this.status = 'settling';
    const er = this.er!;
    const final = decodeMatch((await er.getAccountInfo(this.match, 'processed'))!.data);
    const r = await sendTx(er, [await this.ix.finalize(this.authority.publicKey, this.match, MAX_PLAYERS)], [], this.authority, {
      confirm: true,
    });
    if (r.err) throw new Error(`finalize failed: ${r.err}`);
    const commitSig = await GetCommitmentSignature(r.sig, new Connection(this.erUrl!, 'confirmed'));
    await this.base.confirmTransaction(commitSig, 'confirmed');
    for (let i = 0; i < 120; i++) {
      const info = await this.base.getAccountInfo(this.match, 'confirmed');
      if (info?.owner.equals(PROGRAM_ID)) break;
      await sleep(500);
    }
    const rec = await sendTx(this.base, [await this.ix.recordResult(this.authority.publicKey, this.match)], [], this.authority, {
      confirm: true,
      pollMs: 500,
      timeoutMs: 60_000,
    });
    if (rec.err) throw new Error(`record_result failed: ${rec.err}`);
    let resultInfo = null;
    for (let i = 0; i < 20 && !resultInfo; i++) {
      resultInfo = await this.base.getAccountInfo(pda.result(this.match), 'confirmed');
      if (!resultInfo) await sleep(500);
    }
    const res = resultInfo ? decodeResult(resultInfo.data) : null;
    this.result = {
      winnerIndex: final.winner,
      placements: final.placements,
      transfers: final.transfers,
      vrfFulfilled: final.vrfFulfilled,
      crankLagMs: this.crankLagMs.map(Math.round),
      lastRandomness: Buffer.from(final.lastRandomness).toString('hex'),
      commitSig,
      recordSig: rec.sig,
      resultPda: pda.result(this.match).toBase58(),
      resultWinner: res?.winner.toBase58() ?? null,
    };
  }
}
