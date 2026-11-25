import { useEffect, useMemo, useState } from 'react';
import { audio } from '../audio/audio';
import { CHARACTERS, GAME_TITLE, characterDef } from '../game/content';
import type { ParticipantSetup } from '../game/sim';
import type { CharacterId } from '../game/types';
import type { Profile } from '../state/settings';
import { Icon } from './Icon';
import { Portrait } from './Portrait';


/** The "O" of the wordmark: a bomb engraved in the same gold as the letters, fuse lit. */
function BombO() {
  return (
    <svg className="logo-o" viewBox="0 0 100 118" aria-hidden>
      <defs>
        <linearGradient id="logo-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7e2a8" />
          <stop offset="0.55" stopColor="#d4ae62" />
          <stop offset="1" stopColor="#8f6c2c" />
        </linearGradient>
      </defs>
      <path d="M66 30 C 72 14, 84 12, 90 6" fill="none" stroke="url(#logo-gold)" strokeWidth="6" strokeLinecap="round" />
      <rect x="50" y="28" width="20" height="13" rx="2" fill="url(#logo-gold)" transform="rotate(32 60 34)" />
      <circle cx="46" cy="76" r="34" fill="none" stroke="url(#logo-gold)" strokeWidth="15" />
      <path d="M27 66 A 20 20 0 0 1 40 54" fill="none" stroke="#fff4d0" strokeWidth="4" strokeLinecap="round" opacity="0.55" />
      <g className="logo-spark">
        <circle cx="90" cy="6" r="7" fill="#ffb347" opacity="0.35" />
        <path d="M90 -2 L92 4 L98 6 L92 8 L90 14 L88 8 L82 6 L88 4 Z" fill="#ffe2a0" />
      </g>
    </svg>
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
}) {
  const [name, setName] = useState(initial?.name ?? `deckhand${Math.floor(100 + Math.random() * 900)}`);
  const [character, setCharacter] = useState<CharacterId>(initial?.character ?? 'frog');
  const clean = name.trim().slice(0, 18);
  const idx = CHARACTERS.findIndex((c) => c.id === character);
  const cycle = (d: number) => {
    const next = CHARACTERS[(idx + d + CHARACTERS.length) % CHARACTERS.length].id;
    setCharacter(next);
    onCharacter(next);
  };

  // ← / → switch hero (unless you're typing your name)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
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

  return (
    <div className="screen landing">
      <div className="menu-shade" />

      <label className="name-chip" title="Your name">
        <Portrait id={hero.id} size={34} />
        <input value={name} maxLength={18} onChange={(e) => setName(e.target.value)} spellCheck={false} aria-label="Your name" />
        <Icon name="pencil" size={18} />
      </label>

      <div className="menu-left">
        <h1 className="logo" aria-label={GAME_TITLE}>
          <span className="logo-word">BL</span>
          <BombO />
          <span className="logo-word">WUP</span>
        </h1>
        <p className="tagline">Pass the bomb. Nobody knows how long the fuse is.</p>
        <div className="rule" aria-hidden />

        <nav className="menu-list">
          {onRejoin && (
            <button className="mbtn hot" onClick={onRejoin}>
              Rejoin match
            </button>
          )}
          {pendingRoom && (
            <button className="mbtn hot" onClick={go(onPrivateRoom)} disabled={!clean}>
              Join room {pendingRoom}
            </button>
          )}
          <button className="mbtn primary" onClick={go(onPlay)} disabled={!clean} autoFocus>
            Play
            <small>vs bots</small>
          </button>
          <button className="mbtn" onClick={go(onPlayOnline)} disabled={!clean} title="A live match on a MagicBlock rollup (Solana devnet)">
            Online
            <small>devnet</small>
          </button>
          {!pendingRoom && (
            <button className="mbtn" onClick={go(onPrivateRoom)} disabled={!clean}>
              Private room
              <small>with friends</small>
            </button>
          )}
        </nav>
        {notice && <p className="verify-status warn">{notice}</p>}
      </div>

      <div className="picker" style={{ '--c': hero.color } as React.CSSProperties}>
        <button className="picker-arrow" onClick={() => cycle(-1)} aria-label="Previous hero">
          <Icon name="prev" size={26} fill="#fff" />
        </button>
        <div className="picker-mid">
          <div className="picker-name" key={hero.id}>{hero.name}</div>
          <div className="picker-dots">
            {CHARACTERS.map((c) => (
              <button
                key={c.id}
                className={c.id === character ? 'on' : ''}
                style={{ background: c.color }}
                onClick={() => {
                  setCharacter(c.id);
                  onCharacter(c.id);
                }}
                aria-label={c.name}
              />
            ))}
          </div>
        </div>
        <button className="picker-arrow" onClick={() => cycle(1)} aria-label="Next hero">
          <Icon name="next" size={26} fill="#fff" />
        </button>
      </div>

      <div className="how">
        <span><kbd>WASD</kbd> move</span>
        <span><kbd>Left click</kbd> throw</span>
        <span><kbd>Right click</kbd> tag</span>
        <span><kbd>Space</kbd> dash</span>
        <span><kbd>E</kbd> item</span>
        <span className="how-free">No wallet needed · same stats for everyone</span>
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
          <h2>{filled < ordered.length ? (filled === 1 ? 'Rounding up a crew…' : 'Filling the empty spots…') : 'All aboard'}</h2>
          <span className="room-code">Room {code}</span>
        </div>
        <div className="slots">
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
                    <span className="spinner" /> waiting
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
          <button className="btn" onClick={onStart}>
            Start now
          </button>
        </div>
      </div>
    </div>
  );
}
