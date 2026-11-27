import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { audio } from '../audio/audio';
import { CHARACTERS, GAME_TITLE, characterDef } from '../game/content';
import type { ParticipantSetup } from '../game/sim';
import type { CharacterId } from '../game/types';
import type { Profile } from '../state/settings';
import { Icon } from './Icon';
import { Portrait } from './Portrait';
import { NetworkCredits } from './NetworkCredits';
import { heroTurn, stageReady, titleView } from '../render/MenuStage';


/** The title sign: carved driftwood letters with the bomb as the O, its fuse spark animated. */
function Wordmark({ className = '' }: { className?: string }) {
  return (
    <h1 className={`logo ${className}`}>
      <img src={`${import.meta.env.BASE_URL}ui/title-logo.webp`} alt={GAME_TITLE} draggable={false} />
      <span className="logo-spark" aria-hidden />
    </h1>
  );
}

/** The title card shows once per visit, before the menu. */
let titleSeen = false;

/**
 * How far the 3D harbour has loaded (three.js's shared loading manager sees every model and texture). Done once
 * everything requested has arrived and nothing new has started for a moment, or after a safety timeout.
 */
function useHarbourLoaded(): { done: boolean; progress: number } {
  const [state, setState] = useState({ done: false, progress: 0 });
  useEffect(() => {
    const m = THREE.DefaultLoadingManager;
    let loaded = 0;
    let total = 0;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    // done = nothing left loading AND the harbour has been drawn (cached models load before the first frame does)
    const settle = () => {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(function check() {
        if (stageReady.drawn) setState({ done: true, progress: 1 });
        else quiet = setTimeout(check, 100);
      }, loaded >= total ? 300 : 2500);
    };
    m.onProgress = (_url, l, t) => {
      loaded = l;
      total = t;
      setState((s) => (s.done ? s : { done: false, progress: t ? l / t : 0 }));
      settle();
    };
    m.onLoad = settle;
    settle(); // already loaded before we looked
    const cap = setTimeout(() => setState({ done: true, progress: 1 }), 12000);
    return () => {
      m.onProgress = () => {};
      m.onLoad = () => {};
      if (quiet) clearTimeout(quiet);
      clearTimeout(cap);
    };
  }, []);
  return state;
}

/** The first thing you see: the logo and a fuse burning along a rope while the harbour loads. */
function LoadingVeil({ progress, done }: { progress: number; done: boolean }) {
  const pct = Math.round(Math.max(0.04, progress) * 100);
  return (
    <div className={`loading-veil ${done ? 'gone' : ''}`} aria-busy={!done} aria-label="Loading">
      <Wordmark className="loading-logo" />
      <p className="loading-text"><span>Loading the harbour</span><span>{pct}%</span></p>
      <div className="loading-rope" aria-hidden>
        <div className="loading-burnt" style={{ width: `${pct}%` }} />
        <div className="loading-spark" style={{ left: `${pct}%` }} />
      </div>

      <NetworkCredits />
    </div>
  );
}

/**
 * Title screen: the wordmark over the live harbour (the 3D dock behind, flying a slow circle round the bay in this
 * match's weather and time of day), waiting for any key or tap. On start the logo glides up into its menu spot, the
 * camera glides down to your hero, and the menu slides in.
 */
function TitleScreen({ onStart }: { onStart: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const { done, progress } = useHarbourLoaded();
  useEffect(() => {
    titleView.on = true;
    return () => {
      titleView.on = false;
    };
  }, []);
  const start = () => {
    if (leaving || !done) return;
    audio.unlock();
    titleView.on = false; // start the glide while the title fades
    setLeaving(true);
    setTimeout(onStart, 650);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // modifier keys alone (Alt-Tabbing back in, say) don't count as "any key"
      if (e.repeat || ['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS'].includes(e.key)) return;
      e.preventDefault();
      start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className={`title-screen ${leaving ? 'leaving' : ''} ${done ? 'ready' : ''}`} onPointerDown={start} role="button" tabIndex={-1} aria-label="Start">
      <div className="title-shade" aria-hidden />
      <div className="title-center">
        <Wordmark className="title-logo" />
        <div className="ribbon title-ribbon">Pass the bomb. Don't be holding it.</div>
      </div>
      <div className="title-start">Click or press any key</div>
      <LoadingVeil progress={progress} done={done} />
    </div>
  );
}

export function Landing({
  initial,
  onPlay,
  onPlayOnline,
  onPrivateRoom,
  pendingRoom,
  onRejoin,
  notice,
  onCharacter,
  onTutorial,
  walletControls,
  onProfileChange,
}: {
  initial: Profile | null;
  onPlay: (p: Profile) => void;
  onPlayOnline: (p: Profile) => void;
  onPrivateRoom: (p: Profile) => void;
  /** Room code from an invite link. */
  pendingRoom: string | null;
  /** Offered when a live online match can be rejoined. */
  onRejoin: (() => void) | null;
  notice: string | null;
  /** The pick changed: the 3D dock behind shows them. */
  onCharacter: (c: CharacterId) => void;
  /** How to play: a guided practice round. */
  onTutorial: (p: Profile) => void;
  walletControls: React.ReactNode;
  onProfileChange: (profile: Profile) => void;
}) {
  const [name, setName] = useState(initial?.name ?? `deckhand${Math.floor(100 + Math.random() * 900)}`);
  const [character, setCharacter] = useState<CharacterId>(initial?.character ?? 'frog');
  // Skip the title card for invite links and rejoins: those people came to play.
  const [title, setTitle] = useState(() => !titleSeen && !pendingRoom && !onRejoin && !new URLSearchParams(location.search).has('quick'));
  const clean = name.trim().slice(0, 18);
  const idx = CHARACTERS.findIndex((c) => c.id === character);
  const cycle = (d: number) => {
    heroTurn.dir = d < 0 ? -1 : 1; // the left arrow spins the hero in the other way
    const next = CHARACTERS[(idx + d + CHARACTERS.length) % CHARACTERS.length].id;
    setCharacter(next);
    onCharacter(next);
    if (clean) onProfileChange({ name: clean, character: next });
  };

  // ← / → switch hero (unless you're typing your name)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (title || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const go = (fn: (p: Profile) => void) => () => {
    if (!clean) return;
    audio.unlock();
    fn({ name: clean, character });
  };
  const hero = characterDef(character);
  const [mode, setMode] = useState<'bots' | 'online' | 'private'>('bots');

  if (title)
    return (
      <div className="screen landing">
        <TitleScreen
          onStart={() => {
            titleSeen = true;
            setTitle(false);
          }}
        />
      </div>
    );

  const MODES = [
    { id: 'bots', label: 'Bots', sub: 'vs bots', go: onPlay },
    { id: 'online', label: 'Online', sub: 'online match', go: onPlayOnline },
    { id: 'private', label: 'Private', sub: 'with friends', go: onPrivateRoom },
  ] as const;
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div className="screen landing lobby-menu menu-in">
      <div className="menu-vignette" aria-hidden />

      <div className="lobby-top">
        <Wordmark className="lobby-logo" />
      </div>

      <button className="picker-arrow prev hero-prev" onClick={() => cycle(-1)} aria-label="Previous hero" />
      <button className="picker-arrow next hero-next" onClick={() => cycle(1)} aria-label="Next hero" />

      <div className="hero-plaque" key={hero.id}>
        <span>{hero.name}</span>
      </div>

      <div className="hero-row" role="radiogroup" aria-label="Hero">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            className={`hero-chip ${c.id === character ? 'on' : ''}`}
            style={{ '--c': c.color } as React.CSSProperties}
            onClick={() => {
              heroTurn.dir = CHARACTERS.findIndex((x) => x.id === c.id) < idx ? -1 : 1;
              setCharacter(c.id);
              onCharacter(c.id);
            }}
            role="radio"
            aria-checked={c.id === character}
            aria-label={c.name}
          >
            <Portrait id={c.id} size={50} />
          </button>
        ))}
      </div>

      <div className="play-dock">
        {notice && <p className="verify-status warn">{notice}</p>}
        {onRejoin && (
          <button className="btn danger" onClick={onRejoin}>
            Rejoin match
          </button>
        )}
        {pendingRoom && (
          <button className="btn danger" onClick={go(onPrivateRoom)} disabled={!clean}>
            Join room {pendingRoom}
          </button>
        )}
        <section className="player-card" aria-label="Player profile">
        <label className="play-name" title="Your name">
          <span>Player name</span>
          <input value={name} maxLength={18} onChange={(e) => {
            const value = e.currentTarget.value;
            setName(value);
            if (value.trim()) onProfileChange({ name: value.trim(), character });
          }} spellCheck={false} aria-label="Your name" />
          <Icon name="pencil" size={16} />
        </label>
        {walletControls}
        </section>
        <div className="mode-switch" role="tablist" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={m.id === mode} className={m.id === mode ? 'on' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <button className="play-btn" onClick={go(current.go)} disabled={!clean} autoFocus>
          Play
          <small>{current.sub}</small>
        </button>
      </div>

      <div className="how">
        <button className="btn plank how-btn" onClick={go(onTutorial)} disabled={!clean}>
          How to play
        </button>
      </div>
    </div>
  );
}

/**
 * Quick Play lobby: human slots first, bots fill after a short matchmaking
 * window. Online matchmaking is not implemented yet, so this always fills
 * with bots.
 */
export function Lobby({ participants, onStart, onCancel }: { participants: ParticipantSetup[]; onStart: () => void; onCancel: () => void }) {
  const ordered = useMemo(() => [...participants].sort((a, b) => Number(a.isBot) - Number(b.isBot)), [participants]);
  const [filled, setFilled] = useState(1);
  const code = useMemo(() => Math.random().toString(36).slice(2, 6).toUpperCase(), []);

  useEffect(() => {
    if (filled >= ordered.length) {
      const t = setTimeout(onStart, 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setFilled((n) => n + 1), filled === 1 ? 1400 : 160);
    return () => clearTimeout(t);
  }, [filled, ordered.length, onStart]);

  return (
    <div className="screen lobby">
      <div className="panel lobby-panel">
        <div className="lobby-head">
          <h2 className="ribbon">{filled < ordered.length ? (filled === 1 ? 'Rounding up a crew' : 'Filling the seats') : 'All aboard'}</h2>
          <span className="room-code">Room {code}</span>
        </div>
        <div className="slots sheet">
          {ordered.map((p, i) => {
            const on = i < filled;
            return (
              <div key={p.id} className={`slot-row ${on ? 'on' : ''}`}>
                {on ? (
                  <>
                    <Portrait id={p.character} bot={p.isBot} seat={participants.indexOf(p)} size={38} />
                    <span className="slot-name">{p.name}</span>
                    {p.isBot ? <span className="bot-badge">BOT</span> : <span className="you-badge">YOU</span>}
                    <span className="ready"><Icon name="check" size={16} /></span>
                  </>
                ) : (
                  <span className="dim">
                    <span className="spinner" /> Waiting
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={onStart}>
            Start now
          </button>
        </div>
      </div>
    </div>
  );
}
