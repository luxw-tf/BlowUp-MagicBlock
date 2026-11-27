/**
 * Runs one online match end to end on devnet + a MagicBlock ER:
 * sponsored setup → delegation → start (VRF) → bots, takeovers + elimination
 * crank → finalize (commit + undelegate) → durable MatchResult on Solana.
 *
 * Seats: 1–6 humans, optionally filled to 6 with bots. A human who goes
 * silent for longer than the on-chain grace period is handed to a bot
 * (`takeover`); if they come back, `renew_session` returns control and the
 * bot steps aside.
 */
import { ConnectionMagicRouter, GetCommitmentSignature } from '@magicblock-labs/ephemeral-rollups-sdk';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { segmentClear, type MapSelection } from '../src/game/arena';
import { BotBrain } from '../src/game/bots';
import { CONFIG } from '../src/game/config';
import { BOT_CHARACTERS, BOT_NAMES } from '../src/game/content';
import { add, dist, norm, scale, sub } from '../src/game/math';
import { holderCanAct, predictMovement, tagCandidates } from '../src/game/sim';
import type { CharacterId, PlayerState } from '../src/game/types';
import { waitForMatchAccounts } from './match-readiness';
import { ChainMirror, indexOf, playerId, type RosterEntry } from '../src/chain/mirror';
import {
  DEFAULT_BASE_RPC,
  DEFAULT_ROUTER,
  MAX_PLAYERS,
  NO_PLAYER,
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
  type ChainPlayer,
} from '../src/chain/program';

export type MatchStatus = 'creating' | 'delegating' | 'starting' | 'live' | 'settling' | 'finished' | 'error';

export interface HumanJoin extends MapSelection {
  name: string;
  character: CharacterId;
  identity: PublicKey;
  session: PublicKey;
  sessionExpiry: number;
  wallet?: PublicKey;
}

interface Bot {
  index: number;
  session: Keypair;
  brain: BotBrain;
  seq: number;
  lastSentAt: number;
  lastSent: { x: number; z: number } | null;
  busyUntil: number; // ms timestamp: pending transfer in flight
  /** True when this bot is covering for a disconnected human. */
  takeover: boolean;
}

/** Seat order that spreads small matches across the arena's spawn points. */
const SEAT_ORDER = [0, 3, 1, 4, 2, 5];
const SEND_INTERVAL_MS = 100; // position updates at 10 Hz
const TICK_MS = 50;
const MATCH_TIMEOUT_MS = 8 * 60_000;
const RANDOMNESS_RETRY_MS = 3_500;
/** Slightly above the on-chain TAKEOVER_GRACE_MS (5 s) so the check passes first time. */
const TAKEOVER_AFTER_MS = 6_000;
/** A player who has not sent any input yet gets this long after the match goes live. */
const FIRST_INPUT_GRACE_MS = 15_000;

const shuffle = <T,>(a: T[]) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unique display names within a match (PRD §09). */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? n : `${n} ${c}`;
  });
}

let counter = 0;

export class MatchRunner {
  readonly id = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  status: MatchStatus = 'creating';
  error: string | null = null;
  readonly matchId = BigInt(Date.now()) * 100n + BigInt(counter % 100);
  readonly match = pda.match(this.matchId);
  roster: RosterEntry[] = [];
  erUrl: string | null = null;
  slotMs = 10;
  validator: PublicKey | null = null;
  result: Record<string, unknown> | null = null;
  readonly createdAt = Date.now();

  private base: Connection;
  private router: ConnectionMagicRouter;
  private ix: ReturnType<typeof instructions>;
  private er: Connection | null = null;
  private clock: SlotClock | null = null;
  private mirror: ChainMirror | null = null;
  private seats: number[] = [];
  private humanSeats = new Map<number, HumanJoin>();
  private chainPlayers = new Map<number, ChainPlayer>();
  private bots = new Map<number, Bot>();
  private localIndices = new Set<number>();
  private subs: (() => void)[] = [];
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastCrankAt = 0;
  private crankLagMs: number[] = [];
  private lastRetryAt = 0;
  private lastTickAt = 0;
  private lastTakeoverCheck = 0;
  private takeoverPending = new Set<number>();
  private liveSince = Date.now();
  readonly events: string[] = [];

  constructor(
    private readonly authority: Keypair,
    private readonly humans: HumanJoin[],
    private readonly opts: MapSelection & { botFill: boolean; baseRpc?: string; router?: string },
  ) {
    if (humans.length < 1 || humans.length > MAX_PLAYERS) throw new Error('1–6 humans per match');
    if (!opts.botFill && humans.length < 2) throw new Error('a match without bots needs at least 2 players');
    this.base = new Connection(opts.baseRpc ?? DEFAULT_BASE_RPC, 'confirmed');
    this.router = new ConnectionMagicRouter(opts.router ?? DEFAULT_ROUTER, { commitment: 'confirmed' });
    this.ix = instructions(this.base);
  }

  private log(...a: unknown[]) {
    console.log(`[match ${this.id}]`, ...a);
  }

  private note(msg: string) {
    this.events.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    this.log(msg);
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
      weather: this.opts.weather,
      mood: this.opts.mood,
      roster: this.roster,
      /** Human seats currently driven by a bot because their player went silent. */
      takeovers: [...this.bots.values()].filter((b) => b.takeover).map((b) => b.index),
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
    this.slotMs = Math.min(1_000, Math.max(10, Math.round(route?.blockTimeMs ?? 10)));

    // Seats: humans get random seats among the used ones; bots fill the rest.
    const total = this.opts.botFill ? MAX_PLAYERS : this.humans.length;
    this.seats = SEAT_ORDER.slice(0, total).sort((a, b) => a - b);
    const humanSeatList = shuffle(this.seats).slice(0, this.humans.length);
    const humanNames = uniqueNames(this.humans.map((h) => h.name));
    const taken = new Set(humanNames.map((n) => n.toLowerCase()));
    const botNames = shuffle(BOT_NAMES.filter((n) => !taken.has(n.toLowerCase())));
    const usedChars = new Set(this.humans.map((h) => h.character));
    const botChars = shuffle([
      ...BOT_CHARACTERS.map((c) => c.id).filter((c) => !usedChars.has(c)),
      ...BOT_CHARACTERS.map((c) => c.id).filter((c) => usedChars.has(c)),
    ]);

    const now = Math.floor(Date.now() / 1000);
    const joins: { index: number; identity: PublicKey; session: PublicKey; expiry: number; wallet?: PublicKey }[] = [];
    let b = 0;
    for (const i of this.seats) {
      const h = humanSeatList.indexOf(i);
      if (h >= 0) {
        const human = this.humans[h];
        this.humanSeats.set(i, human);
        this.roster.push({ index: i, name: humanNames[h], character: human.character, isBot: false, identity: human.identity.toBase58() });
        joins.push({ index: i, identity: human.identity, session: human.session, expiry: human.sessionExpiry, wallet: human.wallet });
        continue;
      }
      const session = Keypair.generate();
      this.bots.set(i, this.newBot(i, session, false));
      this.localIndices.add(i);
      this.roster.push({ index: i, name: botNames[b], character: botChars[b % botChars.length], isBot: true });
      joins.push({ index: i, identity: Keypair.generate().publicKey, session: session.publicKey, expiry: now + 2 * 3600 });
      b++;
    }
    this.roster.sort((a, z) => a.index - z.index);

    const auth = this.authority.publicKey;
    const joinIxs = await Promise.all(joins.map((j) => this.ix.joinMatch(auth, this.match, j.index, j.identity, j.session, j.expiry, j.wallet)));
    await this.base_([await this.ix.createMatch(auth, this.matchId, this.slotMs), ...joinIxs.slice(0, 3)], 'create+join');
    if (joinIxs.length > 3) await this.base_(joinIxs.slice(3), 'join');

    this.status = 'delegating';
    await waitForMatchAccounts((key) => this.base.getAccountInfo(key, 'confirmed'), this.match, joins, 'Solana', 30_000);
    for (const seat of this.seats) {
      await this.base_([await this.ix.delegatePlayer(auth, this.match, seat, this.validator!)], 'delegate player');
    }
    await this.base_([await this.ix.delegateMatch(auth, this.matchId, this.validator)], 'delegate match');

    const t0 = Date.now();
    let fqdn: string | undefined;
    while (Date.now() - t0 < 30_000) {
      const st = await this.router.getDelegationStatus(this.match).catch(() => null);
      if (st?.isDelegated && 'fqdn' in st && typeof st.fqdn === 'string' && st.fqdn) {
        fqdn = st.fqdn;
        break;
      }
      await sleep(250);
    }
    if (!fqdn) throw new Error(`MagicBlock router did not publish a delegation route for match ${this.match.toBase58()}`);
    this.erUrl = fqdn;
    this.er = new Connection(this.erUrl, { commitment: 'processed', wsEndpoint: this.erUrl.replace(/^http/, 'ws') });
    const er = this.er;
    await waitForMatchAccounts((key) => er.getAccountInfo(key, 'processed'), this.match, joins, 'MagicBlock rollup', 60_000);
    this.clock = new SlotClock(this.er, this.slotMs);
    this.clock.start();

    this.note(`delegated to ${this.erUrl} (${this.humans.length} human, ${this.seats.length - this.humans.length} bot)`);
  }

  private newBot(index: number, session: Keypair, takeover: boolean): Bot {
    return {
      index,
      session,
      brain: new BotBrain(playerId(index), (Math.random() * 2 ** 31) | 0),
      seq: 0,
      lastSentAt: 0,
      lastSent: null,
      busyUntil: 0,
      takeover,
    };
  }

  private async base_(ixs: TransactionInstruction[], what: string) {
    const r = await sendTx(this.base, ixs, [], this.authority, { confirm: true, preflight: true, resendMs: 3_000, pollMs: 500, timeoutMs: 60_000 });
    if (r.err) throw new Error(`${what} failed: ${r.err} ${r.sig}`);
  }

  // ───────────────────────── play (ER) ─────────────────────────

  private async play() {
    const er = this.er!;
    const clock = this.clock!;
    const mirror = new ChainMirror(this.roster, clock, this.localIndices, this.match.toBase58(), this.opts);
    this.mirror = mirror;

    this.subs.push(
      watchAccount(
        er,
        this.match,
        (data, slot) => {
          clock.observe(slot);
          for (const e of mirror.applyMatch(decodeMatch(data))) {
            if (e.type === 'elimination') this.note(`eliminated ${e.id}; ${e.survivors} left`);
            if (e.type === 'holderAssigned') this.note(`round ${e.round}: ${e.holder} holds`);
          }
        },
        { pollMs: 500 },
      ),
    );
    // Human seats: track positions, last input slot and session key.
    for (const i of this.humanSeats.keys()) {
      this.subs.push(
        watchAccount(er, pda.player(this.match, i), (data, slot) => {
          clock.observe(slot);
          const p = decodePlayer(data);
          this.chainPlayers.set(i, p);
          mirror.applyPlayer(p);
          this.checkReclaim(p);
        }),
      );
    }
    // Give the websocket subscriptions a moment to establish before starting.
    await sleep(1_000);

    this.status = 'starting';
    const r = await sendTx(er, [await this.ix.startMatch(this.authority.publicKey, this.match)], [], this.authority, { confirm: true });
    if (r.err) throw new Error(`start_match failed: ${r.err}`);
    this.status = 'live';
    this.liveSince = Date.now();
    this.note('started');

    this.lastTickAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      let aborting = false;
      this.loop = setInterval(() => {
        try {
          if (this.tick()) {
            this.stopLoop();
            resolve();
          } else if (!aborting && Date.now() - this.liveSince > MATCH_TIMEOUT_MS) {
            aborting = true;
            this.note('timeout: aborting');
            void this.ix.abortMatch(this.authority.publicKey, this.match)
              .then((ix) => sendTx(er, [ix], [], this.authority, { confirm: true }))
              .then((result) => {
                if (result.err && result.err !== 'WrongPhase') throw new Error(`Match timed out and could not be ended: ${result.err}`);
              }).catch(reject);
          } else if (aborting && Date.now() - this.liveSince > MATCH_TIMEOUT_MS + 20_000) {
            reject(new Error('Match timed out waiting for the rollup to report its final state.'));
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
    if (Date.now() - this.liveSince > MATCH_TIMEOUT_MS) return false;

    for (const bot of this.bots.values()) this.tickBot(bot, nowMs);
    if (nowMs - this.lastTakeoverCheck > 1_000) {
      this.lastTakeoverCheck = nowMs;
      this.checkTakeovers();
    }

    // Elimination crank: permissionless on-chain; the lobby runs it promptly.
    // Start 2 slots early and retry every 150 ms: an early attempt just fails
    // with FuseNotExpired (ER transactions are free), a late one delays play.
    const clock = this.clock!;
    const deadline = Math.min(m.fuseDeadlineSlot || Infinity, m.roundDeadlineSlot || Infinity);
    if (m.phase === PHASE.ACTIVE && m.holder !== 255 && clock.now() >= deadline - 2 && nowMs - this.lastCrankAt > 150) {
      this.lastCrankAt = nowMs;
      const slotMs = m.slotMs;
      const sentLag = (clock.now() - deadline) * slotMs;
      void this.er_([this.ix.eliminate(this.authority.publicKey, this.match)], this.authority).then((r) => {
        const lag = (this.clock!.now() - deadline) * slotMs;
        if (process.env.CRANK_DEBUG) this.log(`crank sent @${Math.round(sentLag)}ms → ${r?.err ?? 'ok'} after ${Math.round(r?.ms ?? -1)}ms (now @${Math.round(lag)}ms)`);
        if (r && !r.err) this.crankLagMs.push(Math.max(0, lag));
      });
    }
    // Bounded pending randomness.
    if (
      m.vrfPurpose !== 0 &&
      (clock.now() - m.vrfRequestedSlot) * m.slotMs >= RANDOMNESS_RETRY_MS &&
      nowMs - this.lastRetryAt > RANDOMNESS_RETRY_MS
    ) {
      this.lastRetryAt = nowMs;
      this.note('VRF pending too long; retrying');
      void this.er_([this.ix.retryRandomness(this.authority.publicKey, this.match)], this.authority);
    }
    return false;
  }

  // ───────────────────────── disconnects ─────────────────────────

  /** Hand silent humans to a bot (the program enforces the grace period). */
  private checkTakeovers() {
    const m = this.mirror!.chain!;
    const clock = this.clock!;
    for (const [i, p] of this.chainPlayers) {
      if (this.bots.has(i) || this.takeoverPending.has(i)) continue;
      if (!(m.aliveMask & (1 << i))) continue;
      // Never-sent players get a longer grace from when the match went live
      // (a real browser still has to load the scene); setup time doesn't count.
      const silentMs = p.lastInputSlot ? (clock.now() - p.lastInputSlot) * m.slotMs : Date.now() - this.liveSince;
      if (silentMs < (p.lastInputSlot ? TAKEOVER_AFTER_MS : FIRST_INPUT_GRACE_MS)) continue;
      this.takeoverPending.add(i);
      const session = Keypair.generate();
      void (async () => {
        const r = await this.er_([this.ix.takeover(this.authority.publicKey, this.match, i, session.publicKey)], this.authority);
        if (r && !r.err) {
          const bot = this.newBot(i, session, true);
          bot.seq = p.seq; // continue after the human's last accepted sequence
          const sp = this.mirror!.state.players.find((q) => q.id === playerId(i));
          if (sp) sp.vel = { x: 0, z: 0 };
          this.bots.set(i, bot);
          this.localIndices.add(i);
          this.note(`${playerId(i)} went silent for ${Math.round(silentMs / 1000)}s: bot took over`);
        }
      })().finally(() => this.takeoverPending.delete(i));
    }
  }

  /** A human who renewed their session (reconnect) takes their seat back. */
  private checkReclaim(p: ChainPlayer) {
    const bot = this.bots.get(p.index);
    if (!bot?.takeover || p.sessionKey.equals(bot.session.publicKey)) return;
    this.bots.delete(p.index);
    this.localIndices.delete(p.index);
    this.note(`${playerId(p.index)} reconnected: control returned`);
  }

  // ───────────────────────── bots ─────────────────────────

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
        if (r.err && !/StaleSequence|ImpossibleMovement|NotSessionKey/.test(r.err)) this.log(`bot ${bot.index} → ${target} rejected: ${r.err}`);
      })().catch(() => {});
    }, delayMs);
  }

  private async er_(ixs: Promise<TransactionInstruction>[] | TransactionInstruction[], payer: Keypair) {
    try {
      const resolved = await Promise.all(ixs);
      const r = await sendTx(this.er!, resolved, [], payer, { confirm: true, timeoutMs: 5_000 });
      if (r.err && !/FuseNotExpired|WrongPhase|RetryTooEarly|NothingPending|PlayerStillActive/.test(r.err)) this.log('ER tx error:', r.err);
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
    const snapshot = await er.getAccountInfo(this.match, 'processed');
    if (!snapshot?.owner.equals(PROGRAM_ID)) throw new Error('Rollup match account unavailable during settlement.');
    const final = decodeMatch(snapshot.data);
    // Eliminated players still have accounts to undelegate. Empty seats do not.
    const occupiedSeats = final.players.flatMap((identity, index) => identity.equals(PublicKey.default) ? [] : [index]);
    if (occupiedSeats.length !== final.playerCount) throw new Error('Rollup match roster is inconsistent during settlement.');
    const r = await sendTx(er, [await this.ix.finalize(this.authority.publicKey, this.match, occupiedSeats)], [], this.authority, {
      confirm: true,
    });
    if (r.err) throw new Error(`finalize failed: ${r.err}`);
    const commitSig = await GetCommitmentSignature(r.sig, new Connection(this.erUrl!, 'confirmed'));
    const commitment = await this.base.confirmTransaction(commitSig, 'confirmed');
    if (commitment.value.err) throw new Error(`Undelegation failed: ${JSON.stringify(commitment.value.err)}`);
    let undelegated = false;
    for (let i = 0; i < 120; i++) {
      const info = await this.base.getAccountInfo(this.match, 'confirmed');
      if (info?.owner.equals(PROGRAM_ID)) {
        undelegated = true;
        break;
      }
      await sleep(500);
    }
    if (!undelegated) throw new Error('Match did not return to Solana ownership after settlement.');
    const rec = await sendTx(this.base, [await this.ix.recordResult(this.authority.publicKey, this.match)], [], this.authority, {
      confirm: true,
      preflight: true,
      resendMs: 3_000,
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
      events: this.events,
    };
    // Match verification is available even while independent profile writes are pending.
    if (final.winner !== NO_PLAYER) void this.recordProfiles(final.wallets);
  }

  private async recordProfiles(wallets: PublicKey[]) {
    const payer = this.authority.publicKey;
    for (const seat of this.seats) {
      const wallet = wallets[seat];
      if (wallet.equals(PublicKey.default)) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const info = await this.base.getAccountInfo(pda.result(this.match), 'confirmed');
          if (info && (decodeResult(info.data).progressRecorded & (1 << seat))) break;
          await this.base_([await this.ix.recordProgress(payer, this.match, seat, wallet)], 'record progress');
          break;
        } catch (error) {
          if (attempt === 2) this.log(`profile update for seat ${seat} failed: ${String(error)}`);
          else await sleep(1_000 * (attempt + 1));
        }
      }
    }
  }
}
