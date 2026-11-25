import { useEffect, useMemo, useState } from 'react';
import { audio } from '../audio/audio';
import { CHARACTERS, GAME_TITLE, characterDef } from '../game/content';
import type { ParticipantSetup } from '../game/sim';
import type { CharacterId } from '../game/types';
import type { Profile } from '../state/settings';

const ICON: Record<CharacterId, string> = {
  frog: '🐸',
  cat: '🐱',
  blob: '🦠',
  rat: '🐀',
  duck: '🦆',
  creature: '👾',
};

export function Landing({
  initial,
  onPlay,
  onPlayOnline,
  onPrivateRoom,
  pendingRoom,
  onRejoin,
  notice,
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
}) {
  const [name, setName] = useState(initial?.name ?? `guest${Math.floor(1000 + Math.random() * 9000)}`);
  const [character, setCharacter] = useState<CharacterId>(initial?.character ?? 'frog');
  const clean = name.trim().slice(0, 18);

  const play = () => {
    if (!clean) return;
    audio.unlock();
    onPlay({ name: clean, character });
  };
  const playOnline = () => {
    if (!clean) return;
    audio.unlock();
    onPlayOnline({ name: clean, character });
  };
  const room = () => {
    if (!clean) return;
    audio.unlock();
    onPrivateRoom({ name: clean, character });
  };

  return (
    <div className="screen landing">
      <div className="landing-bg" />
      <div className="landing-inner">
        <h1 className="logo">
          {GAME_TITLE}
          <span className="logo-bomb">💣</span>
        </h1>
        <p className="tagline">six creatures. one bomb. the fuse lies.</p>

        <div className="panel onboarding">
          <label className="field">
            <span>name</span>
            <input value={name} maxLength={18} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && play()} autoFocus />
          </label>
          <div className="char-grid">
            {CHARACTERS.map((c) => (
              <button
                key={c.id}
                className={`char-card ${character === c.id ? 'selected' : ''}`}
                style={{ '--c': c.color } as React.CSSProperties}
                onClick={() => setCharacter(c.id)}
              >
                <span className="char-icon">{ICON[c.id]}</span>
                <span className="char-name">{c.name}</span>
              </button>
            ))}
          </div>
          {(pendingRoom || onRejoin) && (
            <div className="row">
              {onRejoin && (
                <button className="btn primary big" onClick={onRejoin}>
                  Rejoin your match
                </button>
              )}
              {pendingRoom && (
                <button className="btn primary big" onClick={room} disabled={!clean}>
                  Join room {pendingRoom}
                </button>
              )}
            </div>
          )}
          <div className="row">
            <button className="btn primary big" onClick={play} disabled={!clean}>
              Quick Play
            </button>
            <button className="btn big" onClick={playOnline} disabled={!clean} title="Live match on a MagicBlock rollup (Solana devnet)">
              Play online <small>devnet</small>
            </button>
            {!pendingRoom && (
              <button className="btn" onClick={room} disabled={!clean} title="Create or join a room with friends (online)">
                Private room
              </button>
            )}
          </div>
          {notice && <p className="verify-status warn">{notice}</p>}
          <p className="fine">
            No wallet needed. Identical stats for everyone — only skill (and the fuse) decides. Online matches have no pickups yet.
          </p>
        </div>

        <div className="how">
          <div>
            <kbd>WASD</kbd> move
          </div>
          <div>
            <kbd>LMB</kbd> throw
          </div>
          <div>
            <kbd>RMB</kbd> tag
          </div>
          <div>
            <kbd>Space</kbd> dash
          </div>
          <div>
            <kbd>E</kbd> item
          </div>
        </div>
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
          <h2>{filled < ordered.length ? (filled === 1 ? 'finding players…' : 'filling with bots…') : 'starting'}</h2>
          <span className="room-code">room {code}</span>
        </div>
        <div className="slots">
          {ordered.map((p, i) => {
            const c = characterDef(p.character);
            const on = i < filled;
            return (
              <div key={p.id} className={`slot-row ${on ? 'on' : ''}`}>
                {on ? (
                  <>
                    <span className="char-icon small" style={{ background: c.color }}>
                      {ICON[p.character]}
                    </span>
                    <span className="slot-name">{p.name}</span>
                    {p.isBot ? <span className="bot-badge">BOT</span> : <span className="you-badge">YOU</span>}
                    <span className="ready">ready</span>
                  </>
                ) : (
                  <span className="dim">
                    <span className="spinner" /> open slot
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
