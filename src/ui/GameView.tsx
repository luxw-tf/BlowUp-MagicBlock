import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { audio } from '../audio/audio';
import { ABILITY_DEFS, CALLOUTS, characterDef } from '../game/content';
import { CONFIG } from '../game/config';
import type { SessionLike } from '../game/sessionTypes';
import { alivePlayers, fuseRemaining, getPlayer } from '../game/sim';
import type { GameEvent, MatchState, PlayerId } from '../game/types';
import { InputController } from '../input/input';
import { GameContext, overlay, type GameCtx } from '../render/context';
import { Scene } from '../render/Scene';
import { useSettings } from '../state/settings';
import { Results } from './Results';
import { SettingsPanel } from './SettingsPanel';
import { VerificationPanel } from './VerificationPanel';
import { Icon, type IconName } from './Icon';

interface FeedItem {
  id: number;
  html: React.ReactNode;
}

function Name({ s, id }: { s: MatchState; id: PlayerId | null }) {
  const p = getPlayer(s, id);
  if (!p) return <span>?</span>;
  return (
    <span className="feed-name" style={{ color: characterDef(p.character).color }}>
      {p.name}
      {p.isBot && <span className="bot-badge">BOT</span>}
    </span>
  );
}

interface Props {
  session: SessionLike;
  onRematch: () => void;
  onMenu: () => void;
}

export function GameView({ session, onRematch, onMenu }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const input = useMemo(() => new InputController(), []);
  const ctx = useMemo<GameCtx>(
    () => ({ session, input, focus: { id: session.localId }, renderPos: new Map(), shake: { amount: 0 } }),
    [session, input],
  );
  const settings = useSettings();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [callout, setCallout] = useState<{ text: string; key: number; tone: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [, force] = useState(0);
  const feedId = useRef(0);
  const calloutUntil = useRef(0);

  // Dev-only debugging handle.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __session: SessionLike }).__session = session;
  }, [session]);

  // Wire input + session.
  useEffect(() => {
    if (!wrap.current) return;
    input.attach(wrap.current);
    session.setInputSampler(input.sample);
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
    force((n) => n + 1);
  };

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
      setCallout({ text, key: now, tone });
    };

    const onEvents = (events: GameEvent[]) => {
      for (const e of events) {
        switch (e.type) {
          case 'holderAssigned':
            audio.fuseReset();
            push(
              <>
                <Icon name="bomb" size={16} /> <Name s={s} id={e.holder} /> starts round {e.round} with the bomb
              </>,
            );
            if (e.holder === local) shout('you have the bomb', 'danger', true);
            break;
          case 'fuseSet':
            audio.fuseReset();
            break;
          case 'transfer':
            audio.transfer();
            push(
              <>
                <Name s={s} id={e.from} /> {e.method === 'tag' ? 'tagged' : e.method === 'throw' ? 'beaned' : 'reflected onto'}{' '}
                <Name s={s} id={e.to} />
              </>,
            );
            if (e.fuseLeft < CONFIG.closeCallThreshold && e.method !== 'reflect') shout(CALLOUTS.closeCall, 'good');
            else if (e.to === local) shout('you have the bomb', 'danger');
            break;
          case 'throw':
            audio.throwBomb();
            break;
          case 'miss':
            audio.miss();
            push(
              <>
                <Name s={s} id={e.from} /> airballed
              </>,
            );
            if (e.from === local) shout(CALLOUTS.missedThrow, 'bad');
            break;
          case 'reflected':
            audio.reflect();
            shout(CALLOUTS.reflection, 'good', true);
            break;
          case 'blocked':
            audio.block();
            push(
              <>
                <Name s={s} id={e.by} /> said not today
              </>,
            );
            break;
          case 'dash':
            if (e.id === local) audio.dash();
            break;
          case 'pickupCollected':
            if (e.id === local) audio.pickup();
            break;
          case 'pickupRevealed':
            if (e.id === local) audio.reveal();
            break;
          case 'abilityUsed': {
            const pitch = 0.7 + Object.keys(ABILITY_DEFS).indexOf(e.ability) * 0.15;
            audio.ability(pitch);
            push(
              <>
                <Name s={s} id={e.id} /> used <b style={{ color: ABILITY_DEFS[e.ability].color }}>{ABILITY_DEFS[e.ability].name}</b>
                {e.target && (
                  <>
                    {' '}
                    on <Name s={s} id={e.target} />
                  </>
                )}
              </>,
            );
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
                <Icon name="boom" size={16} /> <Name s={s} id={e.id} /> blew up
              </>,
            );
            const by = getPlayer(s, e.by);
            if (e.id === local) {
              audio.defeat();
              shout(by?.isBot ? CALLOUTS.eliminatedByBot : 'you blew up', 'bad', true);
              const next = alivePlayers(s)[0];
              if (next) ctx.focus.id = next.id;
              force((n) => n + 1);
            } else if (eliminations === 1) {
              shout(CALLOUTS.firstElimination, 'neutral', true);
            }
            if (e.survivors === 2) {
              setTimeout(() => shout(CALLOUTS.finalTwo, 'danger', true), 1500);
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
              shout(CALLOUTS.victory, 'good', true);
            } else {
              shout(`${getPlayer(s, e.winner)?.name} cooked`, 'neutral', true);
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
      <div ref={wrap} className="game-wrap" onPointerDown={() => audio.unlock()}>
        <Canvas
          shadows={settings.shadows ? 'soft' : false}
          dpr={[1, 2]}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
          camera={{ position: [0, 30, 25], near: 0.5, far: 400, fov: 30 }}
        >
          <Scene />
        </Canvas>

        <NameTags session={session} />
        <div className="bomb-indicator" ref={(el) => (overlay.indicator = el)}>
          <div className="bomb-indicator-arrow"><Icon name="arrow" size={20} fill="#ff6b35" /></div>
          <span><Icon name="bomb" size={22} /></span>
        </div>

        <Hud session={session} />

        <div className="feed">
          {feed.map((f) => (
            <div key={f.id} className="feed-item">
              {f.html}
            </div>
          ))}
        </div>

        {callout && (
          <div key={callout.key} className={`callout callout-${callout.tone}`}>
            {callout.text}
          </div>
        )}

        {spectating && (
          <div className="spectator-bar">
            <button onClick={() => cycleSpectate(-1)} aria-label="Previous player"><Icon name="prev" size={16} fill="#f6efe1" /></button>
            <span>
              spectating <Name s={session.state} id={ctx.focus.id} />
            </span>
            <button onClick={() => cycleSpectate(1)} aria-label="Next player"><Icon name="next" size={16} fill="#f6efe1" /></button>
          </div>
        )}

        <div className="top-right">
          <span className="net-pill" title={session.online ? 'Bomb ownership, fuses and eliminations are decided on a MagicBlock rollup' : 'Running the authoritative simulation locally'}>
            {session.online ? 'online · devnet rollup' : `local sim · ${CONFIG.tickRate} tps`}
          </span>
          <button className="icon-btn" title="Match details" onClick={() => setShowVerify(true)}>
            <Icon name="info" size={20} fill="#f6efe1" />
          </button>
          <button className="icon-btn" title="Settings (Esc)" onClick={() => setShowSettings(true)}>
            <Icon name="gear" size={20} fill="#f6efe1" />
          </button>
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

function NameTags({ session }: { session: SessionLike }) {
  return (
    <div className="name-layer">
      {session.state.players.map((p) => (
        <div
          key={p.id}
          className={`name-tag ${p.id === session.localId ? 'is-local' : ''}`}
          ref={(el) => {
            if (el) overlay.tags.set(p.id, el);
            else overlay.tags.delete(p.id);
          }}
        >
          <span style={{ borderColor: characterDef(p.character).color }}>
            {p.id === session.localId ? 'you' : p.name}
            {p.isBot && <em>BOT</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** HUD: high-frequency values are written to refs from a rAF loop. */
function Hud({ session }: { session: SessionLike }) {
  const fuseText = useRef<HTMLDivElement>(null);
  const fuseBar = useRef<HTMLDivElement>(null);
  const roundBar = useRef<HTMLDivElement>(null);
  const dashFill = useRef<HTMLDivElement>(null);
  const fuseBox = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    let lastTickSlot = -1;
    let lastCount = -1;
    let frame = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = session.state;
      const me = getPlayer(s, session.localId)!;
      const fuse = fuseRemaining(s);

      if (fuseText.current && fuseBar.current && fuseBox.current) {
        if (s.phase === 'active' && fuse !== null) {
          fuseText.current.textContent = fuse.toFixed(1);
          const pct = s.bomb.fuseDuration > 0 ? Math.min(1, fuse / s.bomb.fuseDuration) : 0;
          fuseBar.current.style.transform = `scaleX(${pct})`;
          fuseBox.current.dataset.state = fuse < 1 ? 'critical' : fuse < 2.5 ? 'warn' : 'ok';
          // Ticking: per second normally, faster when critical.
          const interval = fuse < 1 ? 0.125 : fuse < 2 ? 0.25 : fuse < 4 ? 0.5 : 1;
          const slot = Math.floor(fuse / interval);
          if (slot !== lastTickSlot) {
            if (lastTickSlot !== -1) audio.tick(Math.max(0, 1 - fuse / 4));
            lastTickSlot = slot;
          }
          if (alivePlayers(s).length === 2) audio.droneIntensity(Math.max(0, 1 - fuse / 4));
        } else if (s.phase === 'active') {
          fuseText.current.textContent = '…';
          fuseBar.current.style.transform = 'scaleX(1)';
          fuseBox.current.dataset.state = 'arming';
          lastTickSlot = -1;
        } else {
          fuseText.current.textContent = '—';
          fuseBar.current.style.transform = 'scaleX(0)';
          fuseBox.current.dataset.state = 'idle';
          lastTickSlot = -1;
        }
      }
      if (roundBar.current) {
        const left = s.phase === 'active' ? Math.max(0, s.roundDeadline - s.time) : CONFIG.roundHardDeadline;
        roundBar.current.style.transform = `scaleX(${left / CONFIG.roundHardDeadline})`;
      }
      if (dashFill.current) {
        const cd = Math.max(0, me.dashReadyAt - s.time);
        dashFill.current.style.transform = `scaleY(${1 - cd / CONFIG.dashCooldown})`;
        dashFill.current.parentElement!.dataset.ready = cd <= 0 ? '1' : '0';
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
        <span className="spinner" /> drawing bomb holder…
      </div>
    );
  else if (s.phase === 'intermission') banner = <div className="phase-banner">{alive} left · next round</div>;

  return (
    <>
      <div className="hud-top">
        <div className="hud-chip">
          ROUND <b>{Math.max(1, s.round)}</b>/{totalRounds}
        </div>
        <div className="fuse" ref={fuseBox} data-state="idle">
          <div className="fuse-label">FUSE</div>
          <div className="fuse-num" ref={fuseText}>
            —
          </div>
          <div className="fuse-track">
            <div className="fuse-fill" ref={fuseBar} />
          </div>
          <div className="round-track" title="Hard round limit">
            <div className="round-fill" ref={roundBar} />
          </div>
          <div className="fuse-holder">
            {holder ? (
              <>
                <Icon name="bomb" size={16} />{' '}
                <span style={{ color: characterDef(holder.character).color }}>
                  {holder.id === session.localId ? 'YOU' : holder.name}
                </span>
              </>
            ) : (
              <span className="dim">no holder</span>
            )}
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
            <div className="dash-fill" ref={dashFill} />
            <span className="slot-glyph"><Icon name="dash" size={24} /></span>
            <span className="slot-key">SPACE</span>
          </div>
          <div
            className={`slot item-slot ${inv && inv !== 'pending' ? 'has-item' : ''}`}
            style={inv && inv !== 'pending' ? { borderColor: ABILITY_DEFS[inv].color, boxShadow: `0 0 18px ${ABILITY_DEFS[inv].color}66` } : undefined}
            title={inv && inv !== 'pending' ? ABILITY_DEFS[inv].blurb : 'Pick up a mystery box'}
          >
            <span className="slot-glyph">{inv === 'pending' ? <span className="spinner" /> : inv ? <Icon name={ABILITY_DEFS[inv].glyph as IconName} size={26} fill={ABILITY_DEFS[inv].color} /> : '·'}</span>
            <span className="slot-key">E</span>
          </div>
          <div className="item-name">
            {inv && inv !== 'pending' ? (
              <>
                <b style={{ color: ABILITY_DEFS[inv].color }}>{ABILITY_DEFS[inv].name}</b>
                <small>{ABILITY_DEFS[inv].blurb}</small>
              </>
            ) : inv === 'pending' ? (
              <small>revealing…</small>
            ) : (
              <small className="dim">no item</small>
            )}
          </div>
        </div>
      )}

      {me.alive && s.bomb.holderId === me.id && s.phase === 'active' && (
        <div className="holder-hint">LEFT CLICK throw · RIGHT CLICK tag</div>
      )}
    </>
  );
}
