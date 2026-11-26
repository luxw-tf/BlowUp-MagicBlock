import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { audio } from '../audio/audio';
import { ABILITY_DEFS, characterDef } from '../game/content';
import { CONFIG } from '../game/config';
import type { SessionLike } from '../game/sessionTypes';
import { alivePlayers, fuseRemaining, getPlayer, holderCanAct, tagCandidates } from '../game/sim';
import type { GameEvent, MatchState, PlayerId } from '../game/types';
import { InputController } from '../input/input';
import { GameContext, overlay, type GameCtx } from '../render/context';
import { Scene } from '../render/Scene';
import { useSettings } from '../state/settings';
import { Results } from './Results';
import { SettingsPanel } from './SettingsPanel';
import { VerificationPanel } from './VerificationPanel';
import { line, type Pool } from './brainrot';
import { Icon, type IconName } from './Icon';
import { Portrait } from './Portrait';

interface FeedItem {
  id: number;
  html: React.ReactNode;
}

/** When a tag last found nobody in reach (drives the "too far" hint). */
const tagMiss = { at: 0 };
/** A throw or tag clicked while you hold the bomb but can't act yet is kept this long, then fires as soon as it can. */
const BUFFER_MS = 200;

/** Who is playing on this screen, so the feed says "You" like the tags and the roster do. */
let localId: PlayerId | null = null;

function Name({ s, id }: { s: MatchState; id: PlayerId | null }) {
  const p = getPlayer(s, id);
  if (!p) return <span>?</span>;
  return (
    <span className="feed-name" style={{ '--c': characterDef(p.character).color } as React.CSSProperties}>
      {p.id === localId ? 'You' : p.name}
      {p.isBot && <span className="bot-badge">BOT</span>}
    </span>
  );
}

interface Pop {
  id: number;
  text: string;
  x: number;
  y: number;
  rot: number;
  size: number;
  color: [string, string];
  delay: number;
}
/** Loud meme colours for the slammed words. */
/** Caption chips, TikTok style: [background, text]. */
const POP_COLOURS: [string, string][] = [
  ['#ffffff', '#111111'],
  ['#111111', '#ffffff'],
  ['#fe2c55', '#ffffff'],
  ['#25f4ee', '#111111'],
  ['#ffe14a', '#111111'],
];

interface Props {
  session: SessionLike;
  onRematch: () => void;
  onMenu: () => void;
}

/** The fuse rope on the HUD: a lazy S from the left edge into the bomb on the right (viewBox 220 × 34). */
const ROPE = 'M 6 20 C 30 6, 52 30, 78 18 S 122 6, 146 18 S 190 28, 222 15';

export function GameView({ session, onRematch, onMenu }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const input = useMemo(() => new InputController(), []);
  const ctx = useMemo<GameCtx>(
    () => ({ session, input, focus: { id: session.localId }, renderPos: new Map(), shake: { amount: 0 } }),
    [session, input],
  );
  const settings = useSettings();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [callout, setCallout] = useState<{ text: string; key: number; tone: string; top: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [, force] = useState(0);
  const feedId = useRef(0);
  const calloutUntil = useRef(0);
  /** Bot trash talk over their heads: one bubble per bot, a few seconds each. */
  const [bubbles, setBubbles] = useState<Record<PlayerId, { text: string; key: number }>>({});
  const lastBubble = useRef(new Map<PlayerId, number>());
  /**
   * Where the big line goes: whichever half of the screen you're not standing in, so it never covers you. Once you're
   * out (no tag on screen) it sits below the middle, clear of the wooden round banner at the top and above the
   * spectator bar; in the top half it never rises into that banner (see the clamp where it is drawn).
   */
  const calloutTop = () => {
    const tag = overlay.tags.get(session.localId);
    const box = wrap.current?.getBoundingClientRect();
    if (!tag || !box || tag.style.display === 'none') return 64;
    const y = (tag.getBoundingClientRect().top - box.top) / box.height;
    return y < 0.5 ? 70 : 30;
  };
  /** Words slammed all over the screen on the big moments. */
  const [pops, setPops] = useState<Pop[]>([]);
  const popId = useRef(0);
  const live = useRef<Pop[]>([]);
  const lastSlam = useRef(-1e9);
  /** A few meme words on a big moment; calm by design: a cooldown between bursts, three on screen at most. */
  const slam = (pool: Pool, n: number, big = false) => {
    const now = performance.now();
    if (!big && now - lastSlam.current < 2500) return;
    lastSlam.current = now;
    const fresh: Pop[] = [];
    const taken = [...live.current];
    for (let i = 0; i < Math.min(n, 3 - live.current.length); i++) {
      // the margins only, so the action and the main line in the middle stay clear; never on top of another sticker
      let spot: { x: number; y: number } | null = null;
      for (let tries = 0; tries < 14 && !spot; tries++) {
        const left = Math.random() < 0.5;
        const c = { x: left ? 9 + Math.random() * 15 : 76 + Math.random() * 15, y: 34 + Math.random() * 44 };
        if (taken.every((p) => Math.abs(p.x - c.x) > 26 || Math.abs(p.y - c.y) > 17)) spot = c;
      }
      if (!spot) break;
      const id = popId.current++;
      const pop = {
        id,
        text: line(pool),
        ...spot,
        rot: (Math.random() - 0.5) * 22,
        size: 1.5 + Math.random() * 0.8,
        color: POP_COLOURS[Math.floor(Math.random() * POP_COLOURS.length)],
        delay: i * 0.25,
      };
      fresh.push(pop);
      taken.push(pop);
    }
    if (!fresh.length) return;
    live.current = [...live.current, ...fresh];
    setPops(live.current);
    const ids = new Set(fresh.map((f) => f.id));
    setTimeout(() => {
      live.current = live.current.filter((x) => !ids.has(x.id));
      setPops(live.current);
    }, 1600 + fresh.length * 120);
  };


  localId = session.localId;
  // Dev-only debugging handle.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __session: SessionLike }).__session = session;
  }, [session]);

  // Wire input + session.
  useEffect(() => {
    if (!wrap.current) return;
    input.attach(wrap.current);
    // clicks are never silently dropped: a throw or tag made while you hold the bomb but can't act yet (recovering
    // from a miss, bomb in flight, fuse still lighting) is kept for a moment and fires on the first tick it can.
    // Only clicks made while holding are kept, so a click just before the bomb reaches you can't pass it straight on.
    const pend = { throw: 0, tag: 0 };
    session.setInputSampler(() => {
      const f = input.sample();
      const s = session.state;
      const me = getPlayer(s, session.localId);
      const now = performance.now();
      const holding = !!me && s.bomb.holderId === me.id && s.phase === 'active';
      if (!holding) pend.throw = pend.tag = 0;
      else {
        if (f.throw) pend.throw = now + BUFFER_MS;
        if (f.tag) pend.tag = now + BUFFER_MS;
        if (f.tag && me && holderCanAct(s, me) && tagCandidates(s, me, f.aim).length === 0) tagMiss.at = now;
      }
      return { ...f, throw: f.throw || now < pend.throw, tag: f.tag || now < pend.tag };
    });
    return () => {
      session.setInputSampler(null);
      input.dispose();
    };
  }, [input, session]);

  useEffect(() => {
    input.enabled = !showSettings && !showVerify;
  }, [input, showSettings, showVerify]);

  useEffect(() => audio.applyVolumes(), [settings]);

  // Keyboard: Esc settings, spectator switching, rematch shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (showVerify) setShowVerify(false);
        else setShowSettings((v) => !v);
      }
      const me = getPlayer(session.state, session.localId);
      if (me && !me.alive && session.state.phase !== 'finished' && (e.code === 'ArrowRight' || e.code === 'ArrowLeft' || e.code === 'KeyD' || e.code === 'KeyA')) {
        cycleSpectate(e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : -1);
      }
      if (me && !me.alive && session.state.phase !== 'finished' && e.code === 'Space') {
        e.preventDefault();
        toggleOverview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, showVerify]);

  const cycleSpectate = (dir: number) => {
    const alive = alivePlayers(session.state);
    if (!alive.length) return;
    const i = alive.findIndex((p) => p.id === ctx.focus.id);
    ctx.focus.id = alive[(i + dir + alive.length) % alive.length].id;
    ctx.focus.overview = false; // picking someone means you want to watch them
    ctx.focus.auto = false;
    force((n) => n + 1);
  };
  const toggleOverview = () => {
    ctx.focus.overview = !ctx.focus.overview;
    force((n) => n + 1);
  };

  const slamRef = useRef(slam);
  slamRef.current = slam;
  // You're holding it and the fuse is nearly out: one panic line per hold.
  useEffect(() => {
    let warned = false;
    let held = false;
    const t = setInterval(() => {
      const s = session.state;
      const holding = s.phase === 'active' && s.bomb.holderId === session.localId;
      if (holding && !held) warned = false;
      held = holding;
      const f = fuseRemaining(s);
      if (holding && !warned && f !== null && f < 1.2) {
        warned = true;
        const now = performance.now();
        calloutUntil.current = now + 1000;
        setCallout({ text: line('youCritical'), key: now, tone: 'danger', top: calloutTop() });
        slamRef.current('wordsCritical', 1);
      }
    }, 100);
    return () => clearInterval(t);
  }, [session]);

  // Event → feed, callouts, audio.
  useEffect(() => {
    let eliminations = 0;
    const s = session.state;
    const local = session.localId;
    const push = (html: React.ReactNode) => {
      const id = feedId.current++;
      setFeed((f) => [...f.slice(-5), { id, html }]);
      setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 5000);
    };
    const shout = (text: string, tone = 'neutral', force = false) => {
      const now = performance.now();
      if (!force && now < calloutUntil.current) return;
      calloutUntil.current = now + 1400;
      setCallout({ text, key: now, tone, top: calloutTop() });
    };
    /** A bot says something (only bots talk; real players' words are their own). */
    const say = (id: PlayerId | null, pool: Pool, chance = 1) => {
      const p = getPlayer(s, id);
      if (!p || !p.isBot || !p.alive || Math.random() > chance) return;
      const now = performance.now();
      if (now - (lastBubble.current.get(p.id) ?? -1e9) < 2400) return;
      lastBubble.current.set(p.id, now);
      setBubbles((b) => ({ ...b, [p.id]: { text: line(pool), key: now } }));
      setTimeout(() => setBubbles((b) => (b[p.id]?.key === now ? (({ [p.id]: _, ...rest }) => rest)(b) : b)), 2600);
    };
    /** Someone near the action reacts. */
    const witness = (exclude: PlayerId[], pool: Pool, chance: number) => {
      const others = alivePlayers(s).filter((p) => p.isBot && !exclude.includes(p.id));
      if (others.length) say(others[Math.floor(Math.random() * others.length)].id, pool, chance);
    };

    const onEvents = (events: GameEvent[]) => {
      for (const e of events) {
        switch (e.type) {
          case 'holderAssigned':
            audio.fuseReset();
            push(
              <>
                <Icon name="bomb" size={16} /> <Name s={s} id={e.holder} /> {e.holder === local ? 'start' : 'starts'} round {e.round} with the bomb
              </>,
            );
            if (e.holder === local) {
              shout(line('youStart'), 'danger', true);
              slam('wordsGot', 1);
            }
            else say(e.holder, 'botGot', 0.8);
            break;
          case 'fuseSet':
            audio.fuseReset();
            break;
          case 'transfer':
            audio.transfer();
            push(
              <>
                <Name s={s} id={e.from} /> {e.method === 'tag' ? 'tagged' : e.method === 'throw' ? 'lobbed it to' : 'bounced it back to'}{' '}
                <Name s={s} id={e.to} />
              </>,
            );
            {
              const late = e.fuseLeft < CONFIG.closeCallThreshold && e.method !== 'reflect';
              if (e.from === local) {
                shout(line(late ? 'youClutch' : 'youPassed'), 'good', late);
                if (late) slam('wordsClutch', 2);
              } else if (e.to === local) {
                shout(line('youGot'), 'danger', late);
                slam('wordsGot', late ? 2 : 1);
              } else if (late) {
                shout(line('youClutch'), 'good');
                slam('wordsClutch', 1);
              }
              say(e.from, late ? 'botClutch' : 'botPassed', late ? 0.95 : 0.6);
              say(e.to, late ? 'botGotLate' : 'botGot', late ? 0.95 : 0.55);
            }
            break;
          case 'throw':
            audio.throwBomb();
            break;
          case 'miss':
            audio.miss();
            // only your own misses make the feed; everyone else's would drown it
            if (e.from === local)
              push(
                <>
                  <Name s={s} id={e.from} /> missed
                </>,
              );
            if (e.from === local) {
              shout(line('youMissed'), 'bad');
              slam('wordsMiss', 1);
            }
            else say(e.from, 'botMissed', 0.6);
            break;
          case 'reflected':
            audio.reflect();
            if (e.by === local) {
              shout(line('youReflected'), 'good', true);
              slam('wordsReflect', 1);
            }
            else say(e.by, 'botReflected', 0.9);
            break;
          case 'blocked':
            audio.block();
            push(
              <>
                <Name s={s} id={e.by} /> said not today
              </>,
            );
            if (e.by === local) {
              shout(line('youBlocked'), 'good', true);
              slam('wordsReflect', 1);
            }
            else say(e.by, 'botBlocked', 0.8);
            break;
          case 'dash':
            if (e.id === local) audio.dash();
            break;
          case 'pickupCollected':
            if (e.id === local) audio.pickup();
            break;
          case 'pickupRevealed':
            if (e.id === local) {
              audio.reveal();
              shout(line('youItem'), 'good');
            }
            break;
          case 'swap':
            if (e.a === local || e.b === local) shout(line('youSwapped'), 'neutral', true);
            break;
          case 'abilityUsed': {
            const pitch = 0.7 + Object.keys(ABILITY_DEFS).indexOf(e.ability) * 0.15;
            audio.ability(pitch);
            push(
              <>
                <Name s={s} id={e.id} /> used <b className="ability-name" style={{ '--c': ABILITY_DEFS[e.ability].color } as React.CSSProperties}>{ABILITY_DEFS[e.ability].name}</b>
                {e.target && (
                  <>
                    {' '}
                    on <Name s={s} id={e.target} />
                  </>
                )}
              </>,
            );
            if (e.ability === 'skillIssue' && e.target) {
              if (e.target === local) shout(line('youSlowed'), 'bad', true);
              else say(e.target, 'botSlowed', 0.8);
            }
            break;
          }
          case 'notice':
            if (e.id === local) shout(e.text, 'good', true);
            break;
          case 'abilityFailed':
          case 'transferRejected':
            if (e.id === local) {
              audio.denied();
              shout(e.reason, 'neutral', true);
            }
            break;
          case 'elimination': {
            eliminations++;
            audio.explosion();
            push(
              <>
                <Icon name="boom" size={16} /> <Name s={s} id={e.id} /> {line('feedOut')}
              </>,
            );
            const by = getPlayer(s, e.by);
            const meAlive = getPlayer(s, local)?.alive;
            if (e.id === local) {
              audio.defeat();
              shout(line(by?.isBot ? 'youOutBot' : 'youOut'), 'bad', true);
              const next = alivePlayers(s)[0];
              if (next) ctx.focus.id = next.id;
              force((n) => n + 1);
            } else if (eliminations === 1) {
              shout(line('firstOut'), 'neutral', true);
            } else if (meAlive && e.survivors > 2) {
              setTimeout(() => shout(line('survived'), 'good', true), 1300);
            }
            slam('wordsBoom', 2, true);
            witness([e.id], 'botWitness', 0.95);
            witness([e.id], 'botWitness', 0.6);
            if (e.survivors === 2) {
              setTimeout(() => {
                shout(line('finalTwo'), 'danger', true);
                slam('wordsFinal', 2, true);
              }, 1500);
              audio.startDrone();
            }
            if (ctx.focus.id === e.id) {
              const next = alivePlayers(s)[0];
              if (next) ctx.focus.id = next.id;
            }
            break;
          }
          case 'matchEnd':
            audio.stopDrone();
            if (e.winner === local) {
              audio.victory();
              shout(line('youWon'), 'good', true);
              slam('wordsWin', 3, true);
            } else {
              shout(line('theyWon', { name: getPlayer(s, e.winner)?.name ?? 'someone' }), 'neutral', true);
              slam('wordsLose', 2, true);
              say(e.winner, 'botWon');
            }
            ctx.focus.id = e.winner;
            setTimeout(() => setShowResults(true), 2600);
            break;
        }
      }
    };
    const unsub = session.subscribe(onEvents);
    return () => {
      unsub();
      audio.stopDrone();
    };
  }, [session, ctx]);

  const me = getPlayer(session.state, session.localId)!;
  const spectating = !me.alive && session.state.phase !== 'finished';

  return (
    <GameContext.Provider value={ctx}>
      <div ref={wrap} className={`game-wrap ${showResults ? 'results-open' : ''}`} onPointerDown={() => audio.unlock()}>
        <Canvas
          shadows={settings.shadows ? 'soft' : false}
          dpr={[1, 1.25]}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
          camera={{ position: [0, 30, 25], near: 0.5, far: 400, fov: 30 }}
        >
          <Scene />
        </Canvas>


        <Hud session={session} bubbles={bubbles} />

        <div className="feed">
          {feed.map((f) => (
            <div key={f.id} className="feed-item">
              {f.html}
            </div>
          ))}
        </div>

        {callout && (
          <div key={callout.key} className={`callout callout-${callout.tone}`} style={{ top: callout.top < 50 ? `max(${callout.top}%, 270px)` : `${callout.top}%`, '--tilt': `${((callout.key % 7) - 3) * 1.6}deg` } as React.CSSProperties}>
            {callout.text}
          </div>
        )}

        <div className="chaos" aria-hidden>
          {pops.map((p) => (
            <span
              key={p.id}
              className="chaos-word"
              style={{ left: `${p.x}%`, top: `${p.y}%`, '--rot': `${p.rot}deg`, '--sz': `${p.size}rem`, '--col': p.color[0], '--fg': p.color[1], animationDelay: `${p.delay}s` } as React.CSSProperties}
            >
              {p.text}
            </span>
          ))}
        </div>

        {spectating && (
          <div className="spectator-bar">
            <button onClick={() => cycleSpectate(-1)} aria-label="Previous player"><Icon name="prev" size={16} fill="#ffffff" /></button>
            <span className="spectating">
              <small>{ctx.focus.overview ? 'Overview' : 'Following'}</small>
              <Name s={session.state} id={ctx.focus.id} />
              {session.state.bomb.holderId === ctx.focus.id && <Icon name="bomb" size={16} title="Holding the bomb" />}
            </span>
            <button onClick={() => cycleSpectate(1)} aria-label="Next player"><Icon name="next" size={16} fill="#ffffff" /></button>
            <button className="spectate-mode" onClick={toggleOverview} title="Space">
              {ctx.focus.overview ? 'Follow' : 'Overview'}
            </button>
          </div>
        )}

        <div className="top-right">
          {session.online && (
            <span className="net-pill" title="Bomb ownership, fuses and eliminations are decided on a MagicBlock rollup">
              Online · devnet rollup
            </span>
          )}
          <button className="icon-btn ic-info" title="Match details" aria-label="Match details" onClick={() => setShowVerify(true)} />
          <button className="icon-btn ic-settings" title="Settings (Esc)" aria-label="Settings" onClick={() => setShowSettings(true)} />
        </div>

        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onLeave={onMenu} />}
        {showVerify && <VerificationPanel session={session} onClose={() => setShowVerify(false)} />}
        {showResults && !showVerify && (
          <Results session={session} onRematch={onRematch} onMenu={onMenu} onVerify={() => setShowVerify(true)} />
        )}
      </div>
    </GameContext.Provider>
  );
}

/**
 * Name tags over each head, filled in the player's colour with their headshot, so everyone reads apart at a glance.
 * Yours is a big gold "You" sign with a pointer; the bomb holder's turns red and pulses. Scene.tsx moves them.
 */
function NameTags({ session, bubbles }: { session: SessionLike; bubbles: Record<PlayerId, { text: string; key: number }> }) {
  const s = session.state;
  return (
    <div className="name-layer">
      {s.players.map((p, seat) => {
        const local = p.id === session.localId;
        const bomb = s.bomb.holderId === p.id;
        return (
          <div
            key={p.id}
            className={`name-tag ${local ? 'is-local' : ''} ${bomb ? 'has-bomb' : ''}`}
            ref={(el) => {
              if (el) overlay.tags.set(p.id, el);
              else overlay.tags.delete(p.id);
            }}
          >
            {bubbles[p.id] && (
              <span key={bubbles[p.id].key} className="nt-bubble">
                {bubbles[p.id].text}
              </span>
            )}
            <span className="nt-pill" style={{ '--c': characterDef(p.character).color } as React.CSSProperties}>
              <Portrait id={p.character} bot={p.isBot} seat={seat} size={local ? 26 : 22} />
              <b>{local ? 'You' : p.name}</b>
              {bomb && <Icon name="bomb" size={15} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Everyone in the match down the right edge: colour, face, who holds the bomb, who is out. */
function Roster({ session }: { session: SessionLike }) {
  const s = session.state;
  return (
    <div className="roster" aria-label="Players">
      {s.players.map((p, seat) => {
        const local = p.id === session.localId;
        const bomb = s.bomb.holderId === p.id && p.alive;
        return (
          <div
            key={p.id}
            className={`roster-row ${local ? 'is-local' : ''} ${bomb ? 'has-bomb' : ''} ${p.alive ? '' : 'is-out'}`}
            style={{ '--c': characterDef(p.character).color } as React.CSSProperties}
          >
            <Portrait id={p.character} bot={p.isBot} seat={seat} size={26} />
            <span className="roster-name">{local ? 'You' : p.name}</span>
            {bomb ? <Icon name="bomb" size={16} title="Holding the bomb" /> : !p.alive ? <Icon name="skull" size={15} title="Out" /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** A painted iron bomb with a brass cap and a sparking fuse, for the off-screen badge. */
function BombBadge() {
  return (
    <svg className="bi-bomb" viewBox="0 0 40 40" aria-hidden>
      <defs>
        <radialGradient id="bi-iron" cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#6a7789" />
          <stop offset="0.5" stopColor="#2c3442" />
          <stop offset="1" stopColor="#12161e" />
        </radialGradient>
        <linearGradient id="bi-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe7a0" />
          <stop offset="1" stopColor="#c8801a" />
        </linearGradient>
      </defs>
      <path d="M26 12 C 28 6, 33 5, 35 3" fill="none" stroke="#3b1f0e" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M26 12 C 28 6, 33 5, 35 3" fill="none" stroke="#b07a40" strokeWidth="2" strokeLinecap="round" />
      <rect x="20" y="10" width="10" height="7" rx="1.5" fill="url(#bi-brass)" stroke="#3b1f0e" strokeWidth="1.6" transform="rotate(32 25 13.5)" />
      <circle cx="18" cy="24" r="13" fill="url(#bi-iron)" stroke="#2a1408" strokeWidth="2.4" />
      <path d="M10.5 20 A 8.5 8.5 0 0 1 16 14.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.45" />
      <g className="bi-spark">
        <circle cx="35" cy="3" r="5" fill="#ffb347" opacity="0.55" />
        <path d="M35 -2 L36.4 1.6 L40 3 L36.4 4.4 L35 8 L33.6 4.4 L30 3 L33.6 1.6 Z" fill="#fff1a8" />
      </g>
    </svg>
  );
}

/**
 * Off-screen bomb holder: their headshot in a brass medallion with a lit bomb on the rim and a pointer aiming at
 * them. Scene.tsx moves the root and rotates its first child (the pointer ring) every frame.
 */
function BombIndicator({ session }: { session: SessionLike }) {
  const s = session.state;
  const holder = getPlayer(s, s.bomb.holderId);
  return (
    <div className="bomb-indicator" ref={(el) => (overlay.indicator = el)}>
      <div className="bomb-indicator-arrow">
        <svg className="bi-pointer" viewBox="0 0 30 34" aria-hidden>
          <defs>
            <linearGradient id="bi-pointer-brass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffe9a6" />
              <stop offset="0.5" stopColor="#f2b234" />
              <stop offset="1" stopColor="#b86a14" />
            </linearGradient>
          </defs>
          <path d="M3 4 Q 2 1 5 2 L 27 15 Q 30 17 27 19 L 5 32 Q 2 33 3 30 L 8 17 Z" fill="url(#bi-pointer-brass)" stroke="#3b1f0e" strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M8 7 L 22 15.5" stroke="#fff6d0" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        </svg>
      </div>
      <div className="bi-halo" aria-hidden />
      <div className="bi-medal">
        {holder && <Portrait id={holder.character} bot={holder.isBot} seat={s.players.indexOf(holder)} size={46} />}
      </div>
      <BombBadge />
      {holder && <span className="bi-name">{holder.name}</span>}
    </div>
  );
}

/** HUD: high-frequency values are written to refs from a rAF loop. */
function Hud({ session, bubbles }: { session: SessionLike; bubbles: Record<PlayerId, { text: string; key: number }> }) {
  const fuseText = useRef<HTMLDivElement>(null);
  /** the rope still to burn (an SVG path drawn from the spark to the bomb) and the spark riding its end */
  const ropeLive = useRef<SVGPathElement>(null);
  const ropeHi = useRef<SVGPathElement>(null);
  const spark = useRef<HTMLDivElement>(null);
  const dashFill = useRef<HTMLDivElement>(null);
  const fuseBox = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    let lastTickSlot = -1;
    // the rope: the fuse's full length when it was lit, and how much of it the spark has eaten (eased)
    let fuseLit = false, fuseTotal = 0, shownBurn = 0, lastFrame = performance.now();
    let lastCount = -1;
    let frame = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = session.state;
      const me = getPlayer(s, session.localId)!;
      const fuse = fuseRemaining(s);

      if (fuseText.current && fuseBox.current) {
        if (s.phase === 'active' && fuse !== null) {
          // no number: the rope on the panel burns down with the fuse, and the last seconds get loud (the spark flares,
          // the line changes, the bomb shakes)
          fuseText.current.textContent = fuse < 1 ? 'any second!' : fuse < 2.5 ? 'it’s hissing…' : s.bomb.holderId === session.localId ? 'have the bomb' : 'has the bomb';
          fuseBox.current.dataset.state = fuse < 1 ? 'critical' : fuse < 2.5 ? 'warn' : 'ok';
          // the off-screen badge pulses faster as the fuse runs down
          overlay.indicator?.style.setProperty('--pulse', `${Math.max(0.16, Math.min(0.9, fuse / 5)).toFixed(2)}s`);
          // Ticking: per second normally, faster when critical.
          const interval = fuse < 1 ? 0.125 : fuse < 2 ? 0.25 : fuse < 4 ? 0.5 : 1;
          const slot = Math.floor(fuse / interval);
          if (slot !== lastTickSlot) {
            if (lastTickSlot !== -1) audio.tick(Math.max(0, 1 - fuse / 4));
            lastTickSlot = slot;
          }
          if (alivePlayers(s).length === 2) audio.droneIntensity(Math.max(0, 1 - fuse / 4));
        } else if (s.phase === 'active') {
          fuseText.current.textContent = 'lighting the fuse…';
          fuseBox.current.dataset.state = 'arming';
          lastTickSlot = -1;
        } else {
          fuseText.current.textContent = s.phase === 'assigning' ? 'drawing…' : 'waiting';
          fuseBox.current.dataset.state = 'idle';
          lastTickSlot = -1;
        }
      }
      // the rope: burnt back from the left as the round runs out, the spark riding the burning end
      if (ropeLive.current && spark.current) {
        // the rope burns with the real fuse: it reaches the bomb exactly as it blows (the round's hard limit can cut a
        // fuse short; time theft can lengthen it, and the rope grows back a little). A fresh rope while arming.
        const tNow = performance.now(), fdt = Math.min(0.1, (tNow - lastFrame) / 1000);
        lastFrame = tNow;
        let target = 0;
        if (s.phase === 'active' && fuse !== null) {
          const left = Math.max(0, Math.min(fuse, s.roundDeadline - s.time));
          if (!fuseLit) { fuseLit = true; fuseTotal = left; shownBurn = 0; }
          fuseTotal = Math.max(fuseTotal, left);
          target = fuseTotal > 0 ? 1 - left / fuseTotal : 1;
        } else if (s.phase === 'active') {
          fuseLit = false; // arming: a new fuse is coming
        } else {
          fuseLit = false;
          target = s.phase === 'intermission' || s.phase === 'finished' ? 1 : 0; // burnt out after a blast
        }
        // the sim ticks 20 times a second: ease the spark between ticks so it creeps smoothly
        shownBurn += (target - shownBurn) * Math.min(1, fdt * 14);
        if (target === 0 && shownBurn < 0.002) shownBurn = 0;
        const burnt = Math.min(1, Math.max(0, shownBurn));
        const live = ropeLive.current;
        const dash = `0 ${(burnt * 100).toFixed(2)} 100`;
        live.style.strokeDasharray = dash;
        if (ropeHi.current) ropeHi.current.style.strokeDasharray = dash;
        const total = live.getTotalLength();
        const pt = live.getPointAtLength(burnt * total);
        spark.current.style.left = `${(pt.x / 220) * 100}%`;
        spark.current.style.top = `${(pt.y / 34) * 100}%`;
      }
      if (dashFill.current) {
        const cd = Math.max(0, me.dashReadyAt - s.time);
        dashFill.current.style.transform = `scaleY(${1 - cd / CONFIG.dashCooldown})`;
        (dashFill.current.closest('.slot') as HTMLElement).dataset.ready = cd <= 0 ? '1' : '0';
      }
      if (s.phase === 'countdown') {
        const n = Math.ceil(s.phaseEndsAt - s.time);
        if (n !== lastCount && n > 0) {
          audio.countdown(false);
          lastCount = n;
        }
      }
      if (++frame % 6 === 0) setTick((t) => t + 1);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  const s = session.state;
  const me = getPlayer(s, session.localId)!;
  const holder = getPlayer(s, s.bomb.holderId);
  const alive = alivePlayers(s).length;
  const totalRounds = s.players.length - 1;
  const inv = me.inventory;

  let banner: React.ReactNode = null;
  if (s.phase === 'countdown') banner = <div className="big-count">{Math.max(1, Math.ceil(s.phaseEndsAt - s.time))}</div>;
  else if (s.phase === 'assigning')
    banner = (
      <div className="phase-banner">
        <span className="spinner" /> Drawing the bomb holder…
      </div>
    );
  else if (s.phase === 'intermission') banner = <div className="phase-banner">{alive} left · next round</div>;

  return (
    <>
      <NameTags session={session} bubbles={bubbles} />
      <BombIndicator session={session} />
      <Roster session={session} />
      <div className="hud-top">
        <div className="hud-chip">
          ROUND <b>{Math.max(1, s.round)}</b>/{totalRounds}
        </div>
        <div className="fuse" ref={fuseBox} data-state="idle">
          {/* who has it: their face and name in their colour (gold for you) */}
          <div className="fuse-who">
            {holder ? (
              <Portrait id={holder.character} bot={holder.isBot} seat={s.players.indexOf(holder)} size={34} />
            ) : (
              <span className="fuse-nobody" aria-hidden />
            )}
            <div className="fuse-whotext">
              <span
                className={`fuse-name ${holder?.id === session.localId ? 'is-you' : ''}`}
                style={holder ? ({ '--c': characterDef(holder.character).color } as React.CSSProperties) : undefined}
              >
                {holder ? (holder.id === session.localId ? 'You' : holder.name) : 'Nobody yet'}
              </span>
              <span className="fuse-sub" ref={fuseText}>
                waiting
              </span>
            </div>
          </div>
          {/* the fuse itself: a twisted rope burning down towards the bomb, reaching it as it blows */}
          <div className="fuse-rope" title="The fuse">
            <svg viewBox="0 0 220 34" preserveAspectRatio="none" aria-hidden>
              <defs>
                {/* the twist: diagonal strands fixed in space, so the rope keeps its lay as it burns away */}
                <pattern id="rope-lay" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(55)">
                  <rect width="6" height="6" fill="#d6a868" />
                  <rect width="2.2" height="6" fill="#9a6634" />
                </pattern>
              </defs>
              <path className="rope-ash" d={ROPE} pathLength={100} />
              <path className="rope-live" ref={ropeLive} d={ROPE} pathLength={100} stroke="url(#rope-lay)" />
              <path className="rope-hi" ref={ropeHi} d={ROPE} pathLength={100} />
            </svg>
            <div className="fuse-spark" ref={spark} aria-hidden>
              <i />
              <i />
              <i />
            </div>
            <svg className="fuse-bomb" viewBox="0 0 32 32" aria-hidden>
              {/* a black iron bomb with a brass cap, the rope running into the cap */}
              <circle cx="17" cy="19" r="11" fill="#1d1e24" />
              <ellipse cx="13" cy="15" rx="3.6" ry="2.4" fill="#5d6170" transform="rotate(-35 13 15)" />
              <rect x="5.5" y="9" width="7" height="5" rx="1.2" fill="#c99a3d" transform="rotate(-40 9 11.5)" />
            </svg>
          </div>
        </div>
        <div className="hud-chip">
          <b>{alive}</b> ALIVE
        </div>
      </div>

      {banner}

      {me.alive && (
        <div className="hud-bottom">
          <div className="slot dash-slot" title="Dash (Space)">
            <span className="slot-face">
              <div className="dash-fill" ref={dashFill} />
              <span className="slot-glyph"><Icon name="dash" size={24} /></span>
            </span>
            <span className="slot-key">SPACE</span>
          </div>
          <div
            className={`slot item-slot ${inv && inv !== 'pending' ? 'has-item' : ''} ${(inv === 'returnToSender' || inv === 'notToday') && s.bomb.holderId === me.id ? 'unusable' : ''}`}
            style={inv && inv !== 'pending' ? { borderColor: ABILITY_DEFS[inv].color, boxShadow: `0 0 18px ${ABILITY_DEFS[inv].color}66` } : undefined}
            title={inv && inv !== 'pending' ? ABILITY_DEFS[inv].blurb : 'Pick up a mystery box'}
          >
            <span className="slot-face">
              <span className="slot-glyph">{inv === 'pending' ? <span className="spinner" /> : inv ? <Icon name={ABILITY_DEFS[inv].glyph as IconName} size={26} fill={ABILITY_DEFS[inv].color} /> : <span className="slot-empty">?</span>}</span>
            </span>
            <span className="slot-key">E</span>
          </div>
          <div className="item-name">
            {inv && inv !== 'pending' ? (
              <>
                <b className="ability-name" style={{ '--c': ABILITY_DEFS[inv].color } as React.CSSProperties}>{ABILITY_DEFS[inv].name}</b>
                <small>{ABILITY_DEFS[inv].blurb}</small>
              </>
            ) : inv === 'pending' ? (
              <small>revealing…</small>
            ) : (
              <small className="dim">Grab a crate</small>
            )}
          </div>
        </div>
      )}

      {me.alive && s.bomb.holderId === me.id && s.phase === 'active' && (
        <div className={`holder-hint ${s.time < me.recoverUntil || s.bomb.fuseDeadline === null ? 'waiting' : performance.now() - tagMiss.at < 1400 ? 'warn' : ''}`}>
          {s.bomb.fuseDeadline === null
            ? 'Lighting the fuse…'
            : s.time < me.recoverUntil
              ? 'Missed! Grab it back…'
              : performance.now() - tagMiss.at < 1400
                ? 'Too far to tag. Get closer, or throw'
                : 'LEFT CLICK throw · RIGHT CLICK tag'}
        </div>
      )}
    </>
  );
}
