import { Keypair } from '@solana/web3.js';
import { expect, it, vi } from 'vitest';
import { Lobby, QUEUE_WINDOW_MS } from '../../server/lobby';

const runners = vi.hoisted(() => [] as { status: string; options: { botFill: boolean; quickPlay?: boolean } }[]);

vi.mock('../../server/match-runner', () => ({
  MatchRunner: class {
    readonly id = String(runners.length);
    status = 'creating';
    constructor(_authority: unknown, _players: unknown, readonly options: { botFill: boolean; quickPlay?: boolean }) {
      runners.push(this);
    }
    async run() {}
  },
}));

it('shares three match slots across morning quick play and private rooms', () => {
  vi.useFakeTimers();
  try {
    const lobby = new Lobby(Keypair.generate(), 3);
    const player = (name: string) => ({
      name,
      character: 'frog' as const,
      identity: Keypair.generate().publicKey,
      session: Keypair.generate().publicKey,
      sessionExpiry: Math.floor(Date.now() / 1000) + 3_600,
    });
    const rooms = [1, 2, 3].map((n) => lobby.createRoom(player(`Host ${n}`)));
    for (const { code, ticket } of rooms) expect(lobby.setReady(code, ticket, true)).toBe(true);
    for (const { code, ticket } of rooms.slice(0, 2)) expect(lobby.startRoom(code, ticket)).toHaveProperty('matchId');
    const queued = lobby.enqueue(player('Quick Play'));
    vi.advanceTimersByTime(QUEUE_WINDOW_MS + 500);
    expect(lobby.ticketView(queued.id)?.status).toBe('matched');
    expect(runners.map(({ options }) => options.quickPlay)).toEqual([undefined, undefined, true]);
    expect(lobby.activeMatches()).toBe(3);

    const { code, ticket } = rooms[2];
    expect(lobby.startRoom(code, ticket)).toHaveProperty('error');
    runners[0].status = 'finished';
    expect(lobby.startRoom(code, ticket)).toHaveProperty('matchId');
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
