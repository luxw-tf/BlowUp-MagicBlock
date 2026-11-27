/**
 * GameSession: the local "transport". Owns the authoritative match state,
 * steps it at a fixed rate, gathers inputs from the local player and bots,
 * forwards randomness requests to the provider and applies fulfilments.
 *
 * In live multiplayer this class is replaced by an ER-backed client that
 * submits inputs and mirrors the delegated accounts; renderers and UI only
 * depend on `state`, events and the interpolation helpers.
 */
import { BotBrain } from './bots';
import { CONFIG, TICK_DT } from './config';
import { BOT_CHARACTERS, BOT_NAMES } from './content';
import { add, scale } from './math';
import { createMatch, drainEvents, fulfillRandomness, step, type ParticipantSetup } from './sim';
import { LAYOUTS, MOODS, WEATHERS, WEATHER_FX, currentWeather, selectLayout, selectMood, selectWeather, weatherFor, type MapSelection } from './arena';
import { LocalDevRandomness, toHex, type RandomFulfillment, type RandomnessProvider } from './randomness';
import type { InputSampler, SessionLike, SessionListener as Listener, VerificationEntry } from './sessionTypes';
import type { CharacterId, InputFrame, MatchState, PlayerId, Vec2 } from './types';

export type { InputSampler, VerificationEntry } from './sessionTypes';

export interface LocalPlayerSetup {
  name: string;
  character: CharacterId;
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function buildParticipants(local: LocalPlayerSetup, total = 6): ParticipantSetup[] {
  const others = shuffle(BOT_CHARACTERS.filter((c) => c.id !== local.character).map((c) => c.id));
  const names = shuffle(BOT_NAMES.filter((n) => n.toLowerCase() !== local.name.toLowerCase()));
  const list: ParticipantSetup[] = [{ id: 'p0', name: local.name, character: local.character, isBot: false }];
  for (let i = 1; i < total; i++) {
    list.push({ id: `bot${i}`, name: names[i - 1], character: others[(i - 1) % others.length], isBot: true });
  }
  // Spawn slots are symmetric; shuffle so the human isn't always in the same corner.
  return shuffle(list);
}

export class GameSession implements SessionLike {
  readonly state: MatchState;
  private static counter = 0;
  readonly id = ++GameSession.counter;
  readonly localId: PlayerId = 'p0';
  /** set by the tutorial (see SessionLike.practice) */
  practice = false;
  readonly online = null;
  readonly verification: VerificationEntry[] = [];
  readonly prevPos = new Map<PlayerId, Vec2>();

  private acc = 0;
  private seq = 0;
  private bots = new Map<PlayerId, BotBrain>();
  private listeners = new Set<Listener>();
  private dispatched = new Map<number, { at: number; attempts: number }>();
  private fulfilled: RandomFulfillment[] = [];
  private sampler: InputSampler | null = null;
  private disposed = false;

  constructor(
    participants: ParticipantSetup[],
    readonly provider: RandomnessProvider = new LocalDevRandomness(),
    map: MapSelection = {},
  ) {
    // a different yard and time of day each match; ?layout=alley&mood=night pins them (handy for recording)
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const li = LAYOUTS.findIndex((l) => l.id === q?.get('layout'));
    const mi = MOODS.findIndex((mood) => mood === (map.mood ?? q?.get('mood') ?? q?.get('weather')));
    selectLayout(li >= 0 ? li : Math.floor(Math.random() * LAYOUTS.length));
    const mood = selectMood(mi >= 0 ? mi : Math.floor(Math.random() * MOODS.length));
    // weather too (?weather=rain); a storm needs the dark, so pinning one without a mood makes it night
    const pw = map.weather ?? WEATHERS.find((w) => w === q?.get('weather'));
    if (pw === 'storm' && mi < 0 && mood !== 'night') selectMood(MOODS.indexOf('night'));
    selectWeather(pw ?? weatherFor(mood, Math.floor(Math.random() * 1e9)));
    this.state = createMatch(participants);
    // gameplay weather is offline only: this class is the local match, never the on-chain mirror
    if (CONFIG.weatherGameplay && q?.get('weatherfx') !== '0') this.state.weatherFx = WEATHER_FX[currentWeather()];
    for (const p of this.state.players) {
      this.prevPos.set(p.id, { ...p.pos });
      if (p.isBot) this.bots.set(p.id, new BotBrain(p.id, Math.floor(Math.random() * 2 ** 31)));
    }
  }

  setInputSampler(fn: InputSampler | null) {
    this.sampler = fn;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }

  /** Advance by real elapsed seconds, running as many fixed ticks as needed. */
  update(dt: number) {
    if (this.disposed) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.tick();
    }
  }

  /** Interpolation factor between previous and current tick. */
  get alpha(): number {
    return this.acc / TICK_DT;
  }

  /**
   * Render position: remote players are interpolated between the last two
   * ticks; the local player is extrapolated along its velocity so input feels
   * immediate (lightweight prediction).
   */
  renderPos(id: PlayerId): Vec2 {
    const p = this.state.players.find((q) => q.id === id)!;
    if (id === this.localId && p.alive) {
      return add(p.pos, scale(p.vel, Math.min(this.acc, TICK_DT)));
    }
    const prev = this.prevPos.get(id) ?? p.pos;
    const a = this.alpha;
    return { x: prev.x + (p.pos.x - prev.x) * a, z: prev.z + (p.pos.z - prev.z) * a };
  }

  private tick() {
    const s = this.state;

    for (const f of this.fulfilled.splice(0)) {
      const applied = fulfillRandomness(s, f.requestId, f.bytes);
      const entry = this.verification.find((e) => e.requestId === f.requestId);
      if (entry && !entry.applied) {
        entry.valueHex = toHex(f.bytes);
        entry.source = f.source;
        entry.proof = f.proof;
        entry.latencyMs = f.latencyMs;
        entry.applied = applied;
      }
      this.dispatched.delete(f.requestId);
    }

    const inputs = new Map<PlayerId, InputFrame>();
    if (this.sampler) {
      const local = s.players.find((p) => p.id === this.localId);
      const frame = this.sampler();
      if (local?.alive) inputs.set(this.localId, { ...frame, seq: this.seq++ });
    }
    for (const [id, brain] of this.bots) inputs.set(id, brain.decide(s));

    for (const p of s.players) this.prevPos.set(p.id, { ...p.pos });
    step(s, inputs);

    this.dispatchRandomness();

    const events = drainEvents(s);
    if (events.length) for (const l of this.listeners) l(events, s);
  }

  private dispatchRandomness() {
    const s = this.state;
    for (const req of s.randomRequests) {
      const d = this.dispatched.get(req.id);
      const retry = !!d && s.time - d.at > CONFIG.randomnessRetryAfter;
      if (d && !retry) continue;
      const attempts = (d?.attempts ?? 0) + 1;
      this.dispatched.set(req.id, { at: s.time, attempts });
      let entry = this.verification.find((e) => e.requestId === req.id);
      if (!entry) {
        entry = {
          requestId: req.id,
          purpose: req.purpose,
          subject: req.subject,
          valueHex: '',
          source: this.provider.label,
          proof: null,
          latencyMs: 0,
          applied: false,
          attempts,
        };
        this.verification.push(entry);
      }
      entry.attempts = attempts;
      this.provider
        .request(req)
        .then((f) => {
          if (!this.disposed) this.fulfilled.push(f);
        })
        .catch(() => {
          // Stays pending; the retry path re-requests it after a bounded wait.
        });
    }
  }
}
