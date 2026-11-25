import { useEffect } from 'react';
import { CALLOUTS, characterDef } from '../game/content';
import type { GameSession } from '../game/session';

const ord = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

export function Results({ session, onRematch, onMenu, onVerify }: { session: GameSession; onRematch: () => void; onMenu: () => void; onVerify: () => void }) {
  const s = session.state;
  const ranked = [...s.players].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99));
  const winner = ranked[0];
  const localWon = winner.id === session.localId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' || e.code === 'Enter') onRematch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRematch]);

  return (
    <div className="modal-backdrop">
      <div className="panel results">
        <div className="results-title">{localWon ? CALLOUTS.victory : `${winner.name} cooked`}</div>
        <div className="results-sub">match lasted {Math.round(s.time)}s</div>
        <table className="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>player</th>
              <th title="Successful tags">tags</th>
              <th title="Throws landed / thrown">throws</th>
              <th title="Seconds holding the bomb">held</th>
              <th title="Passed with under 0.6s left">clutch</th>
              <th title="Abilities used">items</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className={p.id === session.localId ? 'is-local' : ''}>
                <td>{ord(p.placement ?? 6)}</td>
                <td>
                  <span className="dot" style={{ background: characterDef(p.character).color }} />
                  {p.id === session.localId ? `${p.name} (you)` : p.name}
                  {p.isBot && <span className="bot-badge">BOT</span>}
                </td>
                <td>{p.stats.tags}</td>
                <td>
                  {p.stats.throwHits}/{p.stats.throws}
                </td>
                <td>{p.stats.timeHolding.toFixed(1)}s</td>
                <td>{p.stats.closeCalls}</td>
                <td>{p.stats.abilitiesUsed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className="btn primary" onClick={onRematch}>
            Rematch <kbd>R</kbd>
          </button>
          <button className="btn" onClick={onVerify}>
            Match details
          </button>
          <button className="btn ghost" onClick={onMenu}>
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}
