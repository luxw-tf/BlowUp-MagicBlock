/**
 * OnlineSession: a live match on a MagicBlock Ephemeral Rollup.
 *
 *  - Bomb ownership, fuse, rounds and eliminations: mirrored from on-chain
 *    MatchState (authoritative; VRF-drawn).
 *  - Own movement: predicted locally with the offline physics, sent as
 *    absolute positions at 10 Hz (validated on-chain for plausibility).
 *  - Other players: PlayerState account updates over the ER websocket.
 *  - Tag / throw: resolved locally against mirrored positions, then submitted
 *    as a `transfer` transaction that the program range-checks.
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CONFIG, TICK_DT } from '../game/config';
import { add, dist, len, norm, scale, sub, v } from '../game/math';
import type {
  InputSampler,
  OnlineMatchInfo,
  SessionLike,
  SessionListener,
  VerificationEntry,
} from '../game/sessionTypes';
import { circleBlocked, type MapSelection } from '../game/arena';
import { drainEvents, getPlayer, holderCanAct, predictMovement, tagCandidates } from '../game/sim';
import type { GameEvent, PlayerId, PlayerState, Vec2 } from '../game/types';
import { ChainMirror, indexOf, playerId, type RosterEntry } from './mirror';
import {
  PHASE,
  SlotClock,
  decodeMatch,
  decodePlayer,
  instructions,
  pda,
  sendTx,
  unitsToMm,
  watchAccount,
  type ChainMatch,
} from './program';

export interface LobbyMatchInfo extends MapSelection {
  id: string;
  status: string;
  error: string | null;
  programId: string;
  matchPda: string;
  erUrl: string;
  validator: string | null;
  slotMs: number;
  roster: RosterEntry[];
  takeovers?: number[];
  result: Record<string, unknown> | null;
}

/** Remembered so a reload or crash can rejoin the same live match. */
const ACTIVE_KEY = 'blowup.activeMatch';
export function rememberActiveMatch(matchId: string | null) {
  try {
    if (matchId) localStorage.setItem(ACTIVE_KEY, JSON.stringify({ matchId, at: Date.now() }));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage unavailable
  }
}
export function activeMatchId(): string | null {
  try {
    const r = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? 'null') as { matchId: string; at: number } | null;
    return r && Date.now() - r.at < 15 * 60_000 ? r.matchId : null;
  } catch {
    return null;
  }
}

const SEND_INTERVAL_MS = 100;
const KEEPALIVE_MS = 1_000;
let counter = 100_000;

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export class OnlineSession implements SessionLike {
  readonly id = ++counter;
  readonly localId: PlayerId;
  readonly provider = { label: 'MagicBlock VRF (devnet)', verifiable: true };
  readonly verification: VerificationEntry[] = [];
  readonly online: OnlineMatchInfo;

  private readonly mirror: ChainMirror;
  private readonly er: Connection;
  private readonly clock: SlotClock;
  private readonly ix: ReturnType<typeof instructions>;
  private readonly match: PublicKey;
  private readonly myIndex: number;
  private readonly listeners = new Set<SessionListener>();
  private readonly subs: (() => void)[] = [];
  private queued: GameEvent[] = [];
  private sampler: InputSampler | null = null;
  private acc = 0;
  private seq = 0;
  private lastSentAt = 0;
  private lastSent: Vec2 | null = null;
  private transferInFlight = false;
  private vrfRequestedAt = 0;
  private vrfRequestedNonce = -1;
  private lastVrfPurpose = 0;
  private settlementPoll: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly remoteMotion = new Map<PlayerId, { from: Vec2; at: number; duration: number }>();
  private synced = false;
  private reclaiming = false;
  private lastUpdateAt = 0;
  private session: Keypair;

  /**
   * @param identity the guest identity (persistent); finds our seat and can
   *   reclaim it with `renew_session` after a bot takeover.
   * @param session  the per-match session key registered at join (or a fresh
   *   one when rejoining; it is installed via `renew_session`).
   */
  constructor(
    private readonly info: LobbyMatchInfo,
    private readonly identity: Keypair,
    session: Keypair,
    private readonly lobbyUrl = '',
    rejoin = false,
  ) {
    const seat = info.roster.find((r) => r.identity === identity.publicKey.toBase58());
    if (!seat) throw new Error('This match has no seat for you.');
    this.session = session;
    this.myIndex = seat.index;
    this.localId = playerId(seat.index);
    this.match = new PublicKey(info.matchPda);
    this.er = new Connection(info.erUrl, { commitment: 'processed', wsEndpoint: info.erUrl.replace(/^http/, 'ws') });
    this.clock = new SlotClock(this.er, info.slotMs);
    this.clock.start();
    this.ix = instructions(this.er);
    this.mirror = new ChainMirror(info.roster, this.clock, new Set([seat.index]), info.matchPda, info);
    rememberActiveMatch(info.id);
    if (rejoin) void this.reclaim();
    this.online = {
      network: 'Solana devnet + MagicBlock Ephemeral Rollup',
      programId: info.programId,
      matchPda: info.matchPda,
      erUrl: info.erUrl,
      validator: info.validator,
      settlement: 'live',
      resultPda: null,
      commitSig: null,
      recordSig: null,
      error: null,
    };
    this.connect();
  }

  get state() {
    return this.mirror.state;
  }

  get alpha() {
    return this.acc / TICK_DT;
  }

  private connect() {
    this.subs.push(
      watchAccount(
        this.er,
        this.match,
        (data, slot) => {
          this.clock.observe(slot);
          const m = decodeMatch(data);
          this.trackVrf(m);
          this.queued.push(...this.mirror.applyMatch(m));
          if (m.phase === PHASE.FINISHED) {
            rememberActiveMatch(null);
            this.watchSettlement();
          }
        },
        { pollMs: 500 },
      ),
    );
    for (const r of this.info.roster) {
      if (r.index === this.myIndex) continue;
      this.subs.push(
        watchAccount(this.er, pda.player(this.match, r.index), (data, slot) => {
          this.clock.observe(slot);
          const player = decodePlayer(data);
          const id = playerId(r.index);
          const now = performance.now();
          const previous = this.remoteMotion.get(id);
          const from = { ...this.renderPos(id) };
          this.mirror.applyPlayer(player);
          this.remoteMotion.set(id, { from, at: now, duration: previous ? Math.min(200, Math.max(50, now - previous.at)) : 0 });

        }),
      );
    }
    // Our own seat: initial position/sequence sync, and takeover detection.
    this.subs.push(
      watchAccount(this.er, pda.player(this.match, this.myIndex), (data, slot) => {
        this.clock.observe(slot);
        const p = decodePlayer(data);
        const me = this.me();
        if (!this.synced) {
          this.synced = true;
          me.pos = { x: p.x / 1000, z: p.z / 1000 };
          me.vel = { x: 0, z: 0 };
        }
        this.seq = Math.max(this.seq, p.seq);
        const active = performance.now() - this.lastUpdateAt < 1_000;
        if (!p.sessionKey.equals(this.session.publicKey)) {
          // A bot is playing our seat. Follow its moves until we take it back.
          me.pos = { x: p.x / 1000, z: p.z / 1000 };
          if (active && me.alive) void this.reclaim();
        }
      }),
    );
  }

  /** Take our seat back from a takeover bot (or install a rejoin key). */
  private async reclaim() {
    if (this.reclaiming || this.disposed) return;
    this.reclaiming = true;
    try {
      const fresh = Keypair.generate();
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const r = await sendTx(
        this.er,
        [await this.ix.renewSession(this.identity.publicKey, this.match, this.myIndex, fresh.publicKey, expiry)],
        [],
        this.identity,
        { confirm: true, timeoutMs: 5_000 },
      );
      if (!r.err) {
        this.session = fresh;
        this.lastSent = null; // force a position send right away
        this.queued.push({ type: 'notice', id: this.localId, text: 'back in control' });
      }
    } finally {
      this.reclaiming = false;
    }
  }

  /** Records each VRF fulfilment (with observed latency) for the details panel. */
  private trackVrf(m: ChainMatch) {
    const prev = this.mirror.chain;
    // Note when we see a request pending, so fulfilment latency is measured
    // only when we actually observed both ends.
    if (m.vrfPurpose !== 0 && (m.vrfPurpose !== this.lastVrfPurpose || !prev || m.vrfNonce !== prev.vrfNonce)) {
      this.vrfRequestedAt = performance.now();
      this.vrfRequestedNonce = m.vrfNonce;
    }
    const fulfilled = prev ? m.vrfFulfilled > prev.vrfFulfilled : m.vrfFulfilled > 0;
    if (fulfilled) {
      const observed = this.vrfRequestedNonce === m.vrfNonce && this.vrfRequestedAt > 0;
      this.verification.push({
        requestId: m.vrfNonce,
        // A holder draw clears last_giver; a fuse draw follows a transfer.
        purpose: m.lastGiver === 255 ? 'holder' : 'fuse',
        subject: m.holder === 255 ? null : playerId(m.holder),
        valueHex: toHex(m.lastRandomness),
        source: 'MagicBlock VRF',
        proof: null,
        latencyMs: observed ? performance.now() - this.vrfRequestedAt : -1,
        applied: true,
        attempts: 1,
      });
      this.vrfRequestedAt = 0;
    }
    this.lastVrfPurpose = m.vrfPurpose;
  }

  private watchSettlement() {
    if (this.settlementPoll) return;
    this.online.settlement = 'settling';
    this.settlementPoll = setInterval(async () => {
      try {
        const r = (await (await fetch(`${this.lobbyUrl}/api/matches/${this.info.id}`)).json()) as LobbyMatchInfo;
        if (r.status === 'finished' && r.result) {
          this.online.settlement = 'settled';
          rememberActiveMatch(null);
          this.online.resultPda = String(r.result.resultPda ?? '');
          this.online.commitSig = String(r.result.commitSig ?? '');
          this.online.recordSig = String(r.result.recordSig ?? '');
          clearInterval(this.settlementPoll!);
        } else if (r.status === 'error') {
          this.online.settlement = 'error';
          this.online.error = r.error;
          clearInterval(this.settlementPoll!);
        }
      } catch {
        // lobby unreachable; keep trying
      }
    }, 1_500);
  }

  setInputSampler(fn: InputSampler | null) {
    this.sampler = fn;
  }

  subscribe(fn: SessionListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
    this.clock.stop();
    if (this.settlementPoll) clearInterval(this.settlementPoll);
    for (const unsub of this.subs) unsub();
  }

  renderPos(id: PlayerId): Vec2 {
    const p = getPlayer(this.state, id)!;
    if (id === this.localId && p.alive) return add(p.pos, scale(p.vel, Math.min(this.acc, TICK_DT)));
    const motion = this.remoteMotion.get(id);
    if (!motion?.duration) return p.pos;
    const t = Math.min(1, (performance.now() - motion.at) / motion.duration);
    return { x: motion.from.x + (p.pos.x - motion.from.x) * t, z: motion.from.z + (p.pos.z - motion.from.z) * t };
  }

  update(dt: number) {
    if (this.disposed) return;
    this.lastUpdateAt = performance.now();
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.tick();
    }
  }

  private me(): PlayerState {
    return getPlayer(this.state, this.localId)!;
  }

  private tick() {
    const s = this.state;
    s.time += TICK_DT;
    this.mirror.syncTimes();
    const me = this.me();

    const frame = this.sampler?.();
    if (frame && me.alive && s.phase !== 'finished') {
      predictMovement(s, me, { ...frame, seq: 0 });
      if (!this.transferInFlight && holderCanAct(s, me)) {
        if (frame.tag) {
          const target = tagCandidates(s, me, frame.aim)[0];
          if (target) this.sendTransfer(indexOf(target.id), 0);
        } else if (frame.throw) {
          this.startThrow(me, frame.aim);
        }
      }
    }
    this.updateProjectile();
    if (s.bomb.holderId && s.phase === 'active') {
      const h = getPlayer(s, s.bomb.holderId);
      if (h) h.stats.timeHolding += TICK_DT;
    }
    if (me.alive && s.phase !== 'finished') this.sendPosition(false);

    const events = [...this.queued, ...drainEvents(s)];
    this.queued = [];
    if (events.length) for (const l of this.listeners) l(events, s);
  }

  private sendPosition(force: boolean) {
    const me = this.me();
    const now = performance.now();
    if (!force && now - this.lastSentAt < SEND_INTERVAL_MS) return;
    const moved = !this.lastSent || dist(this.lastSent, me.pos) > 0.01;
    if (!force && !moved && now - this.lastSentAt < KEEPALIVE_MS) return;
    this.lastSentAt = now;
    this.lastSent = { ...me.pos };
    const seq = ++this.seq;
    void this.ix
      .submitInput(this.session.publicKey, this.match, this.myIndex, seq, unitsToMm(me.pos.x), unitsToMm(me.pos.z))
      .then((ix) => sendTx(this.er, [ix], [], this.session))
      .catch(() => {});
  }

  /** Transfer with our freshest position in the same transaction, so the range check sees it. */
  private sendTransfer(target: number, method: 0 | 1) {
    this.transferInFlight = true;
    const me = this.me();
    const seq = ++this.seq;
    this.lastSentAt = performance.now();
    this.lastSent = { ...me.pos };
    void (async () => {
      const ixs = [
        await this.ix.submitInput(this.session.publicKey, this.match, this.myIndex, seq, unitsToMm(me.pos.x), unitsToMm(me.pos.z)),
        await this.ix.transfer(this.session.publicKey, this.match, this.myIndex, target, method),
      ];
      const r = await sendTx(this.er, ixs, [], this.session, { confirm: true, timeoutMs: 5_000 });
      if (r.err) {
        // e.g. target moved out of range, or the fuse expired first.
        this.queued.push({ type: 'transferRejected', id: this.localId, reason: humanReason(r.err) });
        me.recoverUntil = this.state.time + 0.3;
      }
    })()
      .catch(() => {})
      .finally(() => {
        this.transferInFlight = false;
      });
  }

  private startThrow(me: PlayerState, aim: Vec2) {
    let dir = norm(sub(aim, me.pos));
    if (len(dir) === 0) dir = v(1, 0);
    this.state.bomb.projectile = { ownerId: me.id, pos: add(me.pos, scale(dir, CONFIG.playerRadius * 0.5)), dir, traveled: 0 };
    me.stats.throws++;
    this.state.events.push({ type: 'throw', from: me.id, dir });
  }

  /** Local projectile flight; a hit becomes an on-chain throw transfer. */
  private updateProjectile() {
    const s = this.state;
    const proj = s.bomb.projectile;
    if (!proj) return;
    const me = this.me();
    if (s.bomb.holderId !== me.id) {
      s.bomb.projectile = null; // fuse expired / ownership changed mid-flight
      return;
    }
    const steps = 4;
    const stepLen = (CONFIG.throwSpeed * TICK_DT) / steps;
    for (let i = 0; i < steps; i++) {
      proj.pos = add(proj.pos, scale(proj.dir, stepLen));
      proj.traveled += stepLen;
      const hit = s.players
        .filter(
          (q) =>
            q.alive &&
            q.id !== me.id &&
            !(s.bomb.protectedId === q.id && s.time < s.bomb.protectedUntil) &&
            dist(proj.pos, q.pos) <= CONFIG.playerRadius + CONFIG.bombRadius,
        )
        .sort((a, b) => dist(proj.pos, a.pos) - dist(proj.pos, b.pos))[0];
      if (hit) {
        s.bomb.projectile = null;
        me.stats.throwHits++;
        this.sendTransfer(indexOf(hit.id), 1);
        return;
      }
      if (circleBlocked(proj.pos, CONFIG.bombRadius) || proj.traveled >= CONFIG.throwRange) {
        s.bomb.projectile = null;
        me.recoverUntil = s.time + CONFIG.missRecovery;
        me.stats.misses++;
        s.events.push({ type: 'miss', from: me.id, at: { ...proj.pos } });
        return;
      }
    }
  }
}

function humanReason(err: string): string {
  switch (err) {
    case 'OutOfRange':
      return 'too far';
    case 'FuseExpired':
      return 'too late';
    case 'TargetProtected':
      return 'they just passed it';
    case 'FuseArming':
      return 'fuse arming';
    case 'RoundLocked':
      return 'round is ending';
    default:
      return 'pass rejected';
  }
}

/** Guest identity (persistent) and a fresh per-match session key; neither needs SOL. */
export function guestKeys(): { identity: Keypair; session: Keypair; sessionExpiry: number } {
  const KEY = 'blowup.guest.identity';
  let identity: Keypair;
  try {
    const raw = localStorage.getItem(KEY);
    identity = raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : Keypair.generate();
    if (!raw) localStorage.setItem(KEY, JSON.stringify(Array.from(identity.secretKey)));
  } catch {
    identity = Keypair.generate();
  }
  return { identity, session: Keypair.generate(), sessionExpiry: Math.floor(Date.now() / 1000) + 3600 };
}
