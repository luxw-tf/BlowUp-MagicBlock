/**
 * Multi-client test for Phase 03 milestone 2, against the running lobby
 * (npm run server) on devnet. Each "human" is a real OnlineSession driven by
 * a scripted input sampler (no rendering).
 *
 *   A. Quick play: 3 humans queue together → one match, 3 bots fill.
 *      - human 0 stops sending (tab "frozen") → bot takeover → resumes → reclaims
 *      - human 1 drops its session entirely → takeover → rejoins with a new session
 *   B. Private room: host + 2 join, all ready, bot fill OFF → 3-human match.
 *
 * Usage: npx tsx server/test-multiplayer.ts [A|B|AB]
 */
import { Keypair } from '@solana/web3.js';
import { OnlineSession, type LobbyMatchInfo } from '../src/chain/online-session';
import { TICK_DT } from '../src/game/config';
import { dist, norm, sub } from '../src/game/math';
import type { CharacterId, InputFrame } from '../src/game/types';

const LOBBY = process.env.LOBBY ?? 'http://localhost:8787';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const checks: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = '') => {
  checks.push({ name, pass, detail });
  log(pass ? 'PASS' : 'FAIL', name, detail);
};

async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(`${LOBBY}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${j.error ?? res.status}`);
  return j;
}

/** A scripted player around a real OnlineSession. */
class FakeHuman {
  readonly identity = Keypair.generate();
  session = Keypair.generate();
  readonly expiry = Math.floor(Date.now() / 1000) + 3600;
  os: OnlineSession | null = null;
  paused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastThrow = 0;
  sawFinished = false;
  notices: string[] = [];

  constructor(
    readonly name: string,
    readonly character: CharacterId,
  ) {}

  payload() {
    return {
      name: this.name,
      character: this.character,
      identity: this.identity.publicKey.toBase58(),
      session: this.session.publicKey.toBase58(),
      sessionExpiry: this.expiry,
    };
  }

  async waitForMatch(matchId: string): Promise<LobbyMatchInfo> {
    for (;;) {
      const m = await api<LobbyMatchInfo>(`/api/matches/${matchId}`);
      if (m.status === 'error') throw new Error(`match error: ${m.error}`);
      if ((m.status === 'starting' || m.status === 'live') && m.erUrl) return m;
      await sleep(400);
    }
  }

  start(info: LobbyMatchInfo, rejoin = false) {
    this.os = new OnlineSession(info, this.identity, this.session, LOBBY, rejoin);
    this.os.setInputSampler(() => this.decide());
    this.os.subscribe((events) => {
      for (const e of events) {
        if (e.type === 'notice' && e.id === this.os!.localId) this.notices.push(e.text);
        if (e.type === 'matchEnd') this.sawFinished = true;
      }
    });
    this.timer = setInterval(() => {
      if (!this.paused) this.os?.update(TICK_DT);
    }, TICK_DT * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.os?.dispose();
  }

  seat() {
    return this.os ? Number(this.os.localId.slice(1)) : -1;
  }

  alive() {
    const s = this.os?.state;
    return !!s?.players.find((p) => p.id === this.os!.localId)?.alive;
  }

  /** Holder: chase and pass. Otherwise: keep away from the holder. */
  private decide(): Omit<InputFrame, 'seq'> {
    const s = this.os!.state;
    const me = s.players.find((p) => p.id === this.os!.localId)!;
    const holder = s.players.find((p) => p.id === s.bomb.holderId);
    const frame = { move: { x: 0, z: 0 }, aim: { ...me.pos }, throw: false, tag: false, dash: false, use: false };
    if (!holder) return frame;
    if (holder.id === me.id) {
      const target = s.players
        .filter((p) => p.alive && p.id !== me.id && !(s.bomb.protectedId === p.id && s.time < s.bomb.protectedUntil))
        .sort((a, b) => dist(a.pos, me.pos) - dist(b.pos, me.pos))[0];
      if (!target) return frame;
      const d = dist(target.pos, me.pos);
      frame.move = norm(sub(target.pos, me.pos));
      frame.aim = { ...target.pos };
      if (d < 1.3) frame.tag = true;
      else if (d < 7 && Date.now() - this.lastThrow > 1_200) {
        frame.throw = true;
        this.lastThrow = Date.now();
      }
    } else {
      const away = norm(sub(me.pos, holder.pos));
      frame.move = dist(me.pos, holder.pos) < 8 ? away : { x: 0, z: 0 };
      frame.aim = { ...holder.pos };
    }
    return frame;
  }
}

async function waitFor(what: string, pred: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return true;
    await sleep(500);
  }
  log(`timed out waiting for: ${what}`);
  return false;
}

async function scenarioA() {
  log('── A: quick play, 3 humans + bot fill, takeover + reconnect + rejoin');
  const humans = [new FakeHuman('alpha', 'frog'), new FakeHuman('bravo', 'cat'), new FakeHuman('charlie', 'duck')];
  const tickets = await Promise.all(humans.map((h) => api<{ ticket: string }>('/api/quickplay', h.payload()).then((r) => r.ticket)));
  let matchId: string | null = null;
  await waitFor('queue → match', async () => {
    const views = await Promise.all(tickets.map((t) => api<{ status: string; matchId: string | null }>(`/api/tickets/${t}`)));
    const ids = new Set(views.map((v) => v.matchId));
    if (views.every((v) => v.matchId) && ids.size === 1) matchId = views[0].matchId;
    return !!matchId;
  }, 30_000);
  check('3 queued humans grouped into one match', !!matchId);
  if (!matchId) return;
  const info = await humans[0].waitForMatch(matchId);
  const humanSeats = info.roster.filter((r) => !r.isBot);
  check('roster: 3 humans + 3 bots, unique names', humanSeats.length === 3 && info.roster.length === 6 && new Set(info.roster.map((r) => r.name.toLowerCase())).size === 6,
    info.roster.map((r) => `${r.index}:${r.name}${r.isBot ? '(bot)' : ''}`).join(' '));
  for (const h of humans) h.start(info);
  log('seats', humans.map((h) => `${h.name}=${h.seat()}`).join(' '));

  const matchInfo = () => api<LobbyMatchInfo & { takeovers: number[] }>(`/api/matches/${matchId}`);
  await sleep(8_000);

  // human 0 freezes (stops sending), human 1 drops its session entirely.
  // Freeze / drop players who aren't holding the bomb: a frozen holder just
  // blows up before the takeover window, which tests nothing.
  const holderSeat = (() => {
    const id = humans[0].os!.state.bomb.holderId;
    return id ? Number(id.slice(1)) : -1;
  })();
  const candidates = [...humans.filter((h) => h.alive() && h.seat() !== holderSeat), ...humans.filter((h) => !h.alive() || h.seat() === holderSeat)];
  const [a, b] = candidates;
  if (a.alive() && a.seat() !== holderSeat) {
    a.paused = true;
    log(`${a.name} (seat ${a.seat()}) freezes`);
  }
  const bSeat = b.seat();
  const bAlive = b.alive() && bSeat !== holderSeat;
  if (bAlive) {
    b.stop();
    log(`${b.name} (seat ${bSeat}) disconnects`);
  }
  const tookOver = await waitFor(
    'takeover',
    async () => {
      const m = await matchInfo();
      return (!a.paused || !a.alive() || m.takeovers.includes(a.seat())) && (!bAlive || m.takeovers.includes(bSeat) || m.status !== 'live');
    },
    15_000,
  );
  const mi = await matchInfo();
  check('silent players handed to bots (on-chain takeover)', tookOver && mi.takeovers.length > 0, `takeovers ${JSON.stringify(mi.takeovers)}`);

  // human 0 resumes the same session → should reclaim automatically.
  if (a.paused) {
    a.paused = false;
    // Wait for both sides: the lobby can see the re-keyed seat a beat before the
    // client's own confirmation returns and it queues its notice.
    const ok = await waitFor(
      'reclaim by resumed session',
      async () => (!(await matchInfo()).takeovers.includes(a.seat()) && a.notices.includes('back in control')) || !a.alive(),
      15_000,
    );
    if (a.alive() || a.notices.length) {
      check('resumed player reclaims the seat', ok && a.notices.includes('back in control'), `notices ${JSON.stringify(a.notices)}`);
    } else {
      log(`SKIP resumed-player reclaim: ${a.name} was eliminated while frozen (got the bomb), nothing to reclaim`);
    }
  }
  // human 1 rejoins with a brand-new session (as after a reload).
  if (bAlive) {
    const fresh = await api<LobbyMatchInfo>(`/api/matches/${matchId}`);
    if (fresh.status === 'live') {
      b.session = Keypair.generate();
      b.start(fresh, true);
      const ok = await waitFor('rejoin', async () => !(await matchInfo()).takeovers.includes(bSeat) || !b.alive(), 15_000);
      check('rejoined player gets the seat back', ok && b.seat() === bSeat, `seat ${b.seat()}`);
    }
  }

  const finished = await waitFor('match end', async () => (await matchInfo()).status === 'finished', 6 * 60_000);
  const end = await matchInfo();
  check('match finished and settled', finished && !!end.result, JSON.stringify({ transfers: end.result?.transfers, placements: end.result?.placements }));
  check('every client saw the match end', humans.every((h) => h.sawFinished || h.os?.state.phase === 'finished'));
  const events = (end.result?.events as string[] | undefined) ?? [];
  const charlie = humans[2];
  const wrongful = events.filter((e) => e.includes(`p${charlie.seat()} went silent`));
  check('an active player is never taken over', wrongful.length === 0, wrongful.join('; ') || `${events.length} match events`);
  for (const h of humans) h.stop();
}

async function scenarioB() {
  log('── B: private room, 3 humans, bot fill off');
  const [host, j1, j2] = [new FakeHuman('host', 'rat'), new FakeHuman('guest one', 'blob'), new FakeHuman('guest one', 'creature')];
  const { code, ticket: hostTicket } = await api<{ code: string; ticket: string }>('/api/rooms', host.payload());
  const t1 = (await api<{ ticket: string }>(`/api/rooms/${code}/join`, j1.payload())).ticket;
  const t2 = (await api<{ ticket: string }>(`/api/rooms/${code}/join`, j2.payload())).ticket;
  log('room', code);
  const startTooEarly = await fetch(`${LOBBY}/api/rooms/${code}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: hostTicket }) });
  check('start blocked until everyone is ready', startTooEarly.status === 409);
  const notHost = await api<{ ok: boolean }>(`/api/rooms/${code}/settings`, { ticket: t1, botFill: false });
  check('only the host can change bot fill', notHost.ok === false);
  await api(`/api/rooms/${code}/settings`, { ticket: hostTicket, botFill: false });
  for (const t of [hostTicket, t1, t2]) await api(`/api/rooms/${code}/ready`, { ticket: t, ready: true });
  const view = await api<{ members: unknown[]; botFill: boolean }>(`/api/rooms/${code}?ticket=${t1}`);
  check('room view: 3 members, bot fill off', view.members.length === 3 && view.botFill === false);
  const { matchId } = await api<{ matchId: string }>(`/api/rooms/${code}/start`, { ticket: hostTicket });
  const info = await host.waitForMatch(matchId);
  check(
    'room match: 3 humans, no bots, unique names',
    info.roster.length === 3 && info.roster.every((r) => !r.isBot) && new Set(info.roster.map((r) => r.name)).size === 3,
    info.roster.map((r) => `${r.index}:${r.name}`).join(' '),
  );
  for (const h of [host, j1, j2]) h.start(info);
  const finished = await waitFor('room match end', async () => (await api<LobbyMatchInfo>(`/api/matches/${matchId}`)).status === 'finished', 6 * 60_000);
  const end = await api<LobbyMatchInfo>(`/api/matches/${matchId}`);
  check('room match finished and settled', finished && !!end.result, JSON.stringify({ transfers: end.result?.transfers, placements: end.result?.placements }));
  for (const h of [host, j1, j2]) h.stop();
}

const which = (process.argv[2] ?? 'AB').toUpperCase();
try {
  if (which.includes('A')) await scenarioA();
  if (which.includes('B')) await scenarioB();
} catch (e) {
  check('no unexpected error', false, (e as Error).message);
}
log(`${checks.filter((c) => c.pass).length}/${checks.length} checks passed`);
process.exit(checks.every((c) => c.pass) ? 0 : 1);
