import { useEffect, useMemo, useState } from 'react';
import { audio } from '../audio/audio';
import { CHARACTERS, GAME_TITLE, characterDef } from '../game/content';
import type { ParticipantSetup } from '../game/sim';
import type { CharacterId } from '../game/types';
import type { Profile } from '../state/settings';
import { Icon } from './Icon';
import { Portrait } from './Portrait';
import { titleView } from '../render/MenuStage';


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
 * Title screen: the wordmark over the live harbour (the 3D dock behind, flying a slow circle round the bay in this
 * match's weather and time of day), waiting for any key or tap. On start the camera glides down to your hero.
 */
function TitleScreen({ onStart }: { onStart: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    titleView.on = true;
    return () => {
      titleView.on = false;
    };
  }, []);
  const start = () => {
    if (leaving) return;
    audio.unlock();
    titleView.on = false; // start the glide while the title fades
    setLeaving(true);
    setTimeout(onStart, 450);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.key === 'Tab') return;
      e.preventDefault();
      start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className={`title-screen ${leaving ? 'leaving' : ''}`} onPointerDown={start} role="button" tabIndex={-1} aria-label="Start">
      <div className="title-shade" aria-hidden />
      <div className="title-center">
        <Wordmark className="title-logo" />
        <div className="ribbon title-ribbon">Pass the bomb. Don't be holding it.</div>
      </div>
      <div className="title-start">Press any key to start</div>
      <div className="title-foot">A party game for up to six · Live on a MagicBlock rollup</div>
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
  // Skip the title card for invite links and rejoins: those people came to play.
  const [title, setTitle] = useState(() => !titleSeen && !pendingRoom && !onRejoin && !new URLSearchParams(location.search).has('quick'));
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

  return (
    <div className="screen landing menu-in">
      <div className="menu-shade" />

      <label className="name-chip" title="Your name">
        <Portrait id={hero.id} size={34} />
        <input value={name} maxLength={18} onChange={(e) => setName(e.target.value)} spellCheck={false} aria-label="Your name" />
        <Icon name="pencil" size={18} />
      </label>

      <div className="menu-left">
        <Wordmark />
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
        <button className="picker-arrow prev" onClick={() => cycle(-1)} aria-label="Previous hero" />
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
        <button className="picker-arrow next" onClick={() => cycle(1)} aria-label="Next hero" />
      </div>

      <div className="how">
        <span><kbd>WASD</kbd> move</span>
        <span><kbd>Left click</kbd> throw</span>
        <span><kbd>Right click</kbd> tag</span>
        <span><kbd>Space</kbd> dash</span>
        <span><kbd>E</kbd> item</span>
        <span className="how-free">No wallet needed. Same stats for everyone.</span>
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
