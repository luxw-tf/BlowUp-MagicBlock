/**
 * Mirrors on-chain match accounts into the client's `MatchState`, so the
 * existing renderer, HUD and bot brains work unchanged in online matches.
 *
 * Authority split: bomb ownership, fuse, rounds and eliminations come from
 * the chain. Positions of locally simulated players (the browser's own
 * player, or the server's bots) are predicted here and pushed to the chain;
 * everyone else's positions come from their PlayerState accounts.
 */
import { SPAWNS, selectLayoutFor } from '../game/arena';
import { createMatch, type ParticipantSetup } from '../game/sim';
import type { GameEvent, MatchState, Phase, PlayerState } from '../game/types';
import { mmToUnits, NO_PLAYER, PHASE, type ChainMatch, type ChainPlayer, type SlotClock } from './program';

export interface RosterEntry {
  index: number;
  name: string;
  character: ParticipantSetup['character'];
  isBot: boolean;
  /** Guest identity (base58) for human seats, so a client can find its own seat. */
  identity?: string;
}

export const playerId = (index: number) => `p${index}`;
export const indexOf = (id: string | null) => (id ? Number(id.slice(1)) : NO_PLAYER);

export class ChainMirror {
  readonly state: MatchState;
  chain: ChainMatch | null = null;
  private lastPlayerUpdate = new Map<number, { x: number; z: number; at: number }>();

  constructor(
    roster: RosterEntry[],
    private readonly clock: SlotClock,
    /** Indices whose positions are simulated locally (not overwritten from chain). */
    readonly localIndices: Set<number>,
    /** the match address: picks the layout, so every client and the lobby's bots see the same yard */
    layoutKey?: string,
  ) {
    if (layoutKey) selectLayoutFor(layoutKey);
    const ordered = [...roster].sort((a, b) => a.index - b.index);
    this.state = createMatch(
      ordered.map((r) => ({ id: playerId(r.index), name: r.name, character: r.character, isBot: r.isBot })),
    );
    // Spawn by seat index (matches the program's SPAWNS_MM), not by array order:
    // matches with fewer than 6 seats have gaps.
    for (const p of this.state.players) p.pos = { ...SPAWNS[indexOf(p.id)] };
    this.state.pickups = []; // pickups are disabled in online matches for now
    this.state.phase = 'assigning';
    this.state.randomRequests = [];
  }

  private player(index: number): PlayerState | undefined {
    return this.state.players.find((p) => p.id === playerId(index));
  }

  /** Apply a PlayerState account update. */
  applyPlayer(p: ChainPlayer) {
    if (this.localIndices.has(p.index)) return;
    const sp = this.player(p.index);
    if (!sp) return;
    const x = mmToUnits(p.x);
    const z = mmToUnits(p.z);
    const now = performance.now();
    const last = this.lastPlayerUpdate.get(p.index);
    if (last) {
      const dt = Math.max(0.05, (now - last.at) / 1000);
      sp.vel = { x: (x - last.x) / dt, z: (z - last.z) / dt };
    }
    this.lastPlayerUpdate.set(p.index, { x, z, at: now });
    sp.pos = { x, z };
  }

  /** Apply a MatchState account update; returns derived game events. */
  applyMatch(m: ChainMatch): GameEvent[] {
    const prev = this.chain;
    this.chain = m;
    const s = this.state;
    const events: GameEvent[] = [];
    const id = (i: number) => (i === NO_PLAYER ? null : playerId(i));

    // Alive / placements / winner.
    for (const p of s.players) {
      const i = indexOf(p.id);
      const alive = (m.aliveMask & (1 << i)) !== 0;
      if (p.alive && !alive && prev) {
        events.push({
          type: 'elimination',
          id: p.id,
          by: id(prev.lastGiver),
          at: { ...p.pos },
          survivors: popcount(m.aliveMask),
        });
        p.eliminatedAt = s.time;
      }
      p.alive = alive;
      p.placement = m.placements[i] || null;
    }

    if (prev && m.phase === PHASE.ACTIVE) {
      if (prev.phase !== PHASE.ACTIVE) {
        events.push({ type: 'holderAssigned', holder: playerId(m.holder), round: m.round });
        const h = this.player(m.holder);
        if (h) h.stats.received++;
      } else if (prev.holder !== m.holder && m.holder !== NO_PLAYER && prev.holder !== NO_PLAYER) {
        const from = playerId(prev.holder);
        const fuseLeft = prev.fuseDeadlineSlot ? Math.max(0, this.clock.secondsUntil(prev.fuseDeadlineSlot)) : 0;
        events.push({ type: 'transfer', from, to: playerId(m.holder), method: 'tag', fuseLeft });
        const g = this.player(prev.holder);
        const r = this.player(m.holder);
        if (g) {
          g.stats.tags++;
          if (fuseLeft < 0.6) g.stats.closeCalls++;
        }
        if (r) r.stats.received++;
      }
      if (m.fuseDeadlineSlot && (!prev.fuseDeadlineSlot || prev.holder !== m.holder || prev.phase !== PHASE.ACTIVE)) {
        events.push({ type: 'fuseSet', holder: playerId(m.holder), duration: m.fuseMs / 1000 });
      }
    }
    if (prev && prev.phase !== PHASE.FINISHED && m.phase === PHASE.FINISHED && m.winner !== NO_PLAYER) {
      events.push({ type: 'matchEnd', winner: playerId(m.winner) });
    }

    s.round = m.round;
    s.winnerId = id(m.winner);
    this.syncTimes();
    return events;
  }

  /** Recompute time-derived fields from the slot clock. Call every frame/tick. */
  syncTimes() {
    const m = this.chain;
    const s = this.state;
    if (!m) return;
    const at = (slot: number) => s.time + this.clock.secondsUntil(slot);
    const phase: Phase =
      m.phase === PHASE.ACTIVE ? 'active' : m.phase === PHASE.FINISHED ? 'finished' : m.round > 0 ? 'intermission' : 'assigning';
    s.phase = phase;
    s.phaseEndsAt = s.time + 3600; // no client-side phase timer online
    s.bomb.holderId = m.phase === PHASE.ACTIVE && m.holder !== NO_PLAYER ? playerId(m.holder) : null;
    s.bomb.fuseDeadline = m.phase === PHASE.ACTIVE && m.fuseDeadlineSlot ? at(m.fuseDeadlineSlot) : null;
    s.bomb.fuseDuration = m.fuseMs / 1000;
    s.bomb.protectedId = m.protectedPlayer === NO_PLAYER ? null : playerId(m.protectedPlayer);
    s.bomb.protectedUntil = at(m.protectedUntilSlot);
    s.bomb.lastGiverId = m.lastGiver === NO_PLAYER ? null : playerId(m.lastGiver);
    s.roundStart = at(m.roundStartSlot);
    s.roundDeadline = m.phase === PHASE.ACTIVE ? at(m.roundDeadlineSlot) : Infinity;
  }

  /** Seconds the current holder has left (chain time), or null. */
  fuseSecondsLeft(): number | null {
    const m = this.chain;
    if (!m || m.phase !== PHASE.ACTIVE || !m.fuseDeadlineSlot) return null;
    return this.clock.secondsUntil(Math.min(m.fuseDeadlineSlot, m.roundDeadlineSlot));
  }
}

function popcount(n: number) {
  let c = 0;
  for (let x = n; x; x &= x - 1) c++;
  return c;
}
