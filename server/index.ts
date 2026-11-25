/**
 * BlowUp lobby service (local dev). Holds the devnet authority key, sponsors
 * match setup, runs bots, takeovers and the elimination crank, and settles
 * results.
 *
 *   POST   /api/quickplay              join payload → { ticket }
 *   GET    /api/tickets/:t             → { status, matchId, queued, fillInMs }
 *   DELETE /api/tickets/:t             cancel queue / leave room
 *   POST   /api/rooms                  join payload → { code, ticket }
 *   POST   /api/rooms/:code/join       join payload → { ticket }
 *   GET    /api/rooms/:code?ticket=t   → members, ready states, bot fill, status
 *   POST   /api/rooms/:code/ready      { ticket, ready }
 *   POST   /api/rooms/:code/settings   { ticket, botFill }   (host)
 *   POST   /api/rooms/:code/start      { ticket }            (host)
 *   GET    /api/matches/:id            → status, roster, ER endpoint, takeovers, result
 *
 * Join payload: { name, character, identity, session, sessionExpiry }.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { CHARACTERS } from '../src/game/content';
import type { CharacterId } from '../src/game/types';
import { Lobby, QUEUE_WINDOW_MS } from './lobby';
import type { HumanJoin } from './match-runner';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_MATCHES ?? 3);
const KEY_PATH = process.env.AUTHORITY_KEY ?? join(process.cwd(), '.keys/authority.json');

const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, 'utf8'))));
const lobby = new Lobby(authority, MAX_ACTIVE);

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 4_096) throw new Error('body too large');
  }
  return JSON.parse(data || '{}');
}

function parsePubkey(v: unknown): PublicKey | null {
  try {
    return typeof v === 'string' ? new PublicKey(v) : null;
  } catch {
    return null;
  }
}

function parseJoin(b: Record<string, unknown>): HumanJoin | null {
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 18) : '';
  const character = CHARACTERS.find((c) => c.id === b.character)?.id as CharacterId | undefined;
  const identity = parsePubkey(b.identity);
  const session = parsePubkey(b.session);
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(b.sessionExpiry);
  if (!name || !character || !identity || !session || !(expiry > now + 60 && expiry <= now + 24 * 3600)) return null;
  return { name, character, identity, session, sessionExpiry: expiry };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') return json(res, 204, {});

    if (method === 'GET' && path === '/api/health') {
      return json(res, 200, { ok: true, authority: authority.publicKey.toBase58(), active: lobby.activeMatches(), queueWindowMs: QUEUE_WINDOW_MS });
    }

    if (method === 'POST' && path === '/api/quickplay') {
      const human = parseJoin(await readBody(req));
      if (!human) return json(res, 400, { error: 'invalid join request' });
      return json(res, 202, { ticket: lobby.enqueue(human).id });
    }

    let m = /^\/api\/tickets\/([a-f0-9]{32})$/.exec(path);
    if (m && method === 'GET') {
      const view = lobby.ticketView(m[1]);
      return view ? json(res, 200, view) : json(res, 404, { error: 'unknown ticket' });
    }
    if (m && method === 'DELETE') return json(res, 200, { ok: lobby.cancel(m[1]) });

    if (method === 'POST' && path === '/api/rooms') {
      const human = parseJoin(await readBody(req));
      if (!human) return json(res, 400, { error: 'invalid join request' });
      return json(res, 201, lobby.createRoom(human));
    }

    m = /^\/api\/rooms\/([A-Za-z0-9]{5})(?:\/(join|ready|settings|start))?$/.exec(path);
    if (m) {
      const [, code, action] = m;
      if (!action && method === 'GET') {
        const view = lobby.roomView(code, url.searchParams.get('ticket') ?? undefined);
        return view ? json(res, 200, view) : json(res, 404, { error: 'No room with that code.' });
      }
      if (method === 'POST') {
        const b = await readBody(req);
        const ticket = typeof b.ticket === 'string' ? b.ticket : '';
        if (action === 'join') {
          const human = parseJoin(b);
          if (!human) return json(res, 400, { error: 'invalid join request' });
          const r = lobby.joinRoom(code, human);
          return json(res, 'error' in r ? 409 : 201, r);
        }
        if (action === 'ready') return json(res, 200, { ok: lobby.setReady(code, ticket, !!b.ready) });
        if (action === 'settings') return json(res, 200, { ok: lobby.setBotFill(code, ticket, !!b.botFill) });
        if (action === 'start') {
          const r = lobby.startRoom(code, ticket);
          return json(res, 'error' in r ? 409 : 200, r);
        }
      }
    }

    m = /^\/api\/matches\/([a-z0-9]+)$/.exec(path);
    if (m && method === 'GET') {
      const runner = lobby.matches.get(m[1]);
      return runner ? json(res, 200, runner.publicInfo()) : json(res, 404, { error: 'unknown match' });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(
    `BlowUp lobby on http://localhost:${PORT} (authority ${authority.publicKey.toBase58()}, max ${MAX_ACTIVE} live matches, queue window ${QUEUE_WINDOW_MS}ms)`,
  );
});
