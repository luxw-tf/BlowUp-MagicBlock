import { useEffect, useMemo, useState } from 'react';
import { audio } from '../audio/audio';
import { CHARACTERS, GAME_TITLE, characterDef } from '../game/content';
import type { ParticipantSetup } from '../game/sim';
import type { CharacterId } from '../game/types';
import type { Profile } from '../state/settings';
import { Icon } from './Icon';
import { Portrait } from './Portrait';


/** The "o" of the wordmark: a bomb drawn in the same yellow and ink as the letters, fuse lit. */
function BombO() {
  return (
    <svg className="logo-o" viewBox="0 0 100 120" aria-hidden>
      <g stroke="#1d1b24" strokeWidth="15" strokeLinejoin="round" strokeLinecap="round">
        <path d="M62 34 C 70 14, 84 16, 88 6" fill="none" />
        <rect x="47" y="30" width="22" height="16" rx="4" fill="#1d1b24" transform="rotate(32 58 38)" />
        <circle cx="46" cy="80" r="33" fill="#ffc832" />
      </g>
      <path d="M30 66 A 20 20 0 0 1 44 56" fill="none" stroke="#fff6d6" strokeWidth="8" strokeLinecap="round" />
      <g className="logo-spark">
        <path d="M88 -6 L92 2 L101 4 L93 9 L95 18 L88 12 L80 17 L83 8 L76 2 L85 2 Z" fill="#ff6b35" stroke="#1d1b24" strokeWidth="3.5" strokeLinejoin="round" />
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

  // ← / → switch pirate (unless you're typing your name)
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
          <span className="logo-word">Bl</span>
          <BombO />
          <span className="logo-word">wUp</span>
        </h1>
        <p className="tagline">Pass the bomb. Nobody knows how long the fuse is.</p>

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
            <Icon name="next" size={30} fill="#1d1b24" />
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
        <button className="picker-arrow" onClick={() => cycle(-1)} aria-label="Previous pirate">
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
        <button className="picker-arrow" onClick={() => cycle(1)} aria-label="Next pirate">
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
                    <Portrait id={p.character} size={38} />
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
