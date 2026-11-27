/**
 * Matchmaking: a quick-play queue (humans first, bot fill after a window)
 * and private rooms (code + invite link, ready states, host-controlled bot
 * fill). Tickets are bearer secrets held by each client; the public views
 * expose names only.
 */
import { Keypair } from '@solana/web3.js';
import { randomBytes } from 'node:crypto';
import { MAX_PLAYERS } from '../src/chain/program';
import type { Weather } from '../src/game/arena';
import { MatchRunner, type HumanJoin } from './match-runner';

/** PRD §13: matchmaking < 10 s. Humans are grouped first, then bots fill. */
export const QUEUE_WINDOW_MS = Number(process.env.QUEUE_WINDOW_MS ?? 8_000);
/** A client that stops polling is treated as gone. */
const TICKET_STALE_MS = 15_000;
const ROOM_IDLE_MS = 30 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Ticket {
  id: string;
  human: HumanJoin;
  createdAt: number;
  lastSeen: number;
  status: 'queued' | 'room' | 'matched' | 'cancelled';
  matchId: string | null;
  roomCode: string | null;
}

interface Room {
  code: string;
  hostTicket: string;
  members: { ticket: string; ready: boolean }[];
  botFill: boolean;
  weather?: Weather;
  status: 'open' | 'started';
  matchId: string | null;
  lastActivity: number;
}

const newId = () => randomBytes(16).toString('hex');
const newCode = () => Array.from(randomBytes(5), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

export class Lobby {
  readonly matches = new Map<string, MatchRunner>();
  private tickets = new Map<string, Ticket>();
  private queue: string[] = [];
  private rooms = new Map<string, Room>();

  constructor(
    private readonly authority: Keypair,
    private readonly maxActive: number,
  ) {
    setInterval(() => this.matchmake(), 500);
    setInterval(() => this.sweep(), 5_000);
  }

  activeMatches() {
    return [...this.matches.values()].filter((m) => !['finished', 'error'].includes(m.status)).length;
  }

  private newTicket(human: HumanJoin, status: Ticket['status']): Ticket {
    const t: Ticket = { id: newId(), human, createdAt: Date.now(), lastSeen: Date.now(), status, matchId: null, roomCode: null };
    this.tickets.set(t.id, t);
    return t;
  }

  private startMatch(tickets: Ticket[], botFill: boolean, weather?: Weather): MatchRunner {
    const runner = new MatchRunner(
      this.authority,
      tickets.map((t) => t.human),
      { botFill, weather },
    );
    this.matches.set(runner.id, runner);
    for (const t of tickets) {
      t.status = 'matched';
      t.matchId = runner.id;
    }
    void runner.run();
    return runner;
  }

  // ───────────────────────── quick play ─────────────────────────

  enqueue(human: HumanJoin): Ticket {
    const t = this.newTicket(human, 'queued');
    this.queue.push(t.id);
    return t;
  }

  ticketView(id: string) {
    const t = this.tickets.get(id);
    if (!t) return null;
    t.lastSeen = Date.now();
    const queued = this.queue.map((q) => this.tickets.get(q)!).filter(Boolean);
    const oldest = queued[0]?.createdAt ?? Date.now();
    return {
      status: t.status,
      matchId: t.matchId,
      queued: t.status === 'queued' ? queued.length : 0,
      fillInMs: t.status === 'queued' ? Math.max(0, oldest + QUEUE_WINDOW_MS - Date.now()) : 0,
    };
  }

  cancel(id: string) {
    const t = this.tickets.get(id);
    if (!t || t.status === 'matched') return false;
    t.status = 'cancelled';
    this.queue = this.queue.filter((q) => q !== id);
    if (t.roomCode) this.leaveRoom(t.roomCode, id);
    return true;
  }

  private matchmake() {
    this.queue = this.queue.filter((id) => this.tickets.get(id)?.status === 'queued');
    if (!this.queue.length || this.activeMatches() >= this.maxActive) return;
    const oldest = this.tickets.get(this.queue[0])!;
    const group: Ticket[] = [];
    const wallets = new Set<string>();
    const identities = new Set<string>();
    for (const id of this.queue) {
      const ticket = this.tickets.get(id)!;
      const wallet = ticket.human.wallet?.toBase58();
      const identity = ticket.human.identity.toBase58();
      if (identities.has(identity) || (wallet && wallets.has(wallet))) continue;
      identities.add(identity);
      if (wallet) wallets.add(wallet);
      group.push(ticket);
      if (group.length === MAX_PLAYERS) break;
    }
    if (group.length < MAX_PLAYERS && Date.now() - oldest.createdAt < QUEUE_WINDOW_MS) return;
    const matched = new Set(group.map((ticket) => ticket.id));
    this.queue = this.queue.filter((id) => !matched.has(id));
    this.startMatch(group, true, group[0].human.weather);
  }

  // ───────────────────────── private rooms ─────────────────────────

  createRoom(human: HumanJoin) {
    let code = newCode();
    while (this.rooms.has(code)) code = newCode();
    const t = this.newTicket(human, 'room');
    t.roomCode = code;
    this.rooms.set(code, {
      code,
      hostTicket: t.id,
      members: [{ ticket: t.id, ready: false }],
      botFill: true,
      weather: human.weather,
      status: 'open',
      matchId: null,
      lastActivity: Date.now(),
    });
    return { code, ticket: t.id };
  }

  joinRoom(code: string, human: HumanJoin): { ticket: string } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: 'No room with that code.' };
    if (room.status !== 'open') return { error: 'That match already started.' };
    if (room.members.length >= MAX_PLAYERS) return { error: 'Room is full.' };
    if (room.members.some(({ ticket }) => this.tickets.get(ticket)?.human.identity.equals(human.identity))) {
      return { error: 'This browser player already has a seat. Use a different browser profile or device.' };
    }
    const wallet = human.wallet;
    if (wallet && room.members.some(({ ticket }) => this.tickets.get(ticket)?.human.wallet?.equals(wallet))) {
      return { error: 'This wallet already has a seat in the room.' };
    }
    const t = this.newTicket(human, 'room');
    t.roomCode = room.code;
    room.members.push({ ticket: t.id, ready: false });
    room.lastActivity = Date.now();
    return { ticket: t.id };
  }

  roomView(code: string, viewerTicket?: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return null;
    if (viewerTicket) {
      const t = this.tickets.get(viewerTicket);
      if (t) t.lastSeen = Date.now();
    }
    return {
      code: room.code,
      status: room.status,
      botFill: room.botFill,
      weather: room.weather ?? null,
      matchId: room.matchId,
      members: room.members.map((m) => {
        const t = this.tickets.get(m.ticket)!;
        return {
          name: t.human.name,
          character: t.human.character,
          ready: m.ready,
          host: m.ticket === room.hostTicket,
          you: m.ticket === viewerTicket,
        };
      }),
    };
  }

  setReady(code: string, ticket: string, ready: boolean) {
    const room = this.rooms.get(code.toUpperCase());
    const m = room?.members.find((x) => x.ticket === ticket);
    if (!room || !m || room.status !== 'open') return false;
    m.ready = ready;
    room.lastActivity = Date.now();
    return true;
  }

  setRoomSettings(code: string, ticket: string, settings: { botFill?: boolean; weather?: Weather | null }) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.hostTicket !== ticket || room.status !== 'open') return false;
    if (settings.botFill !== undefined) room.botFill = settings.botFill;
    if (settings.weather !== undefined) room.weather = settings.weather ?? undefined;
    room.lastActivity = Date.now();
    return true;
  }

  startRoom(code: string, ticket: string): { matchId: string } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: 'No such room.' };
    if (room.hostTicket !== ticket) return { error: 'Only the host can start.' };
    if (room.status !== 'open') return { error: 'Already started.' };
    if (!room.members.every((m) => m.ready)) return { error: 'Everyone must be ready.' };
    if (!room.botFill && room.members.length < 2) return { error: 'Need 2 players, or turn on bot fill.' };
    if (this.activeMatches() >= this.maxActive) return { error: 'All match slots are busy, try again shortly.' };
    const runner = this.startMatch(
      room.members.map((m) => this.tickets.get(m.ticket)!),
      room.botFill,
      room.weather,
    );
    room.status = 'started';
    room.matchId = runner.id;
    return { matchId: runner.id };
  }

  leaveRoom(code: string, ticket: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.status !== 'open') return false;
    room.members = room.members.filter((m) => m.ticket !== ticket);
    const t = this.tickets.get(ticket);
    if (t) t.status = 'cancelled';
    if (!room.members.length) this.rooms.delete(room.code);
    else if (room.hostTicket === ticket) room.hostTicket = room.members[0].ticket; // hand host to the next member
    room.lastActivity = Date.now();
    return true;
  }

  /** Drop clients that stopped polling, and idle rooms. */
  private sweep() {
    const now = Date.now();
    for (const t of this.tickets.values()) {
      if ((t.status === 'queued' || t.status === 'room') && now - t.lastSeen > TICKET_STALE_MS) {
        if (t.roomCode) this.leaveRoom(t.roomCode, t.id);
        t.status = 'cancelled';
      }
    }
    for (const room of this.rooms.values()) {
      if (room.status === 'open' && now - room.lastActivity > ROOM_IDLE_MS) this.rooms.delete(room.code);
    }
  }
}
