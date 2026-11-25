/**
 * BlowUp lobby service (local dev). Holds the devnet authority key, sponsors
 * match setup, runs bots and the elimination crank, and settles results.
 *
 *   POST /api/quickplay   { name, character, identity, session, sessionExpiry } → { id }
 *   GET  /api/matches/:id → match status, roster, ER endpoint, result
 *   GET  /api/health
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { CHARACTERS } from '../src/game/content';
import type { CharacterId } from '../src/game/types';
import { MatchRunner } from './match-runner';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_MATCHES ?? 3);
const KEY_PATH = process.env.AUTHORITY_KEY ?? join(process.cwd(), '.keys/authority.json');

const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, 'utf8'))));
const matches = new Map<string, MatchRunner>();

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<unknown> {
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

const active = () => [...matches.values()].filter((m) => !['finished', 'error'].includes(m.status)).length;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') return json(res, 204, {});

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, authority: authority.publicKey.toBase58(), active: active() });
    }

    if (req.method === 'POST' && url.pathname === '/api/quickplay') {
      if (active() >= MAX_ACTIVE) return json(res, 503, { error: 'All match slots are busy, try again shortly.' });
      const b = (await readBody(req)) as Record<string, unknown>;
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 18) : '';
      const character = CHARACTERS.find((c) => c.id === b.character)?.id as CharacterId | undefined;
      const identity = parsePubkey(b.identity);
      const session = parsePubkey(b.session);
      const now = Math.floor(Date.now() / 1000);
      const expiry = Number(b.sessionExpiry);
      if (!name || !character || !identity || !session || !(expiry > now + 60 && expiry <= now + 24 * 3600)) {
        return json(res, 400, { error: 'invalid join request' });
      }
      const runner = new MatchRunner(authority, { name, character, identity, session, sessionExpiry: expiry });
      matches.set(runner.id, runner);
      void runner.run();
      return json(res, 202, { id: runner.id });
    }

    const m = /^\/api\/matches\/([a-z0-9]+)$/.exec(url.pathname);
    if (req.method === 'GET' && m) {
      const runner = matches.get(m[1]);
      return runner ? json(res, 200, runner.publicInfo()) : json(res, 404, { error: 'unknown match' });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`BlowUp lobby on http://localhost:${PORT} (authority ${authority.publicKey.toBase58()}, max ${MAX_ACTIVE} live matches)`);
});
