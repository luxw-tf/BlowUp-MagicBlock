import { useEffect } from 'react';
import type { SessionLike } from '../game/sessionTypes';
import { Icon, type IconName } from './Icon';
import { Portrait } from './Portrait';

type P = SessionLike['state']['players'][number];

/** A few honours from the match stats. Only awarded when someone actually earned them. */
function awards(players: P[]): { icon: IconName; title: string; who: string; detail: string }[] {
  const best = (f: (p: P) => number) => players.reduce((a, b) => (f(b) > f(a) ? b : a));
  const out: { icon: IconName; title: string; who: string; detail: string }[] = [];
  const tagger = best((p) => p.stats.tags);
  if (tagger.stats.tags > 0) out.push({ icon: 'dash', title: 'Quickest hands', who: tagger.name, detail: `${tagger.stats.tags} tag${tagger.stats.tags === 1 ? '' : 's'}` });
  const arm = best((p) => p.stats.throwHits);
  if (arm.stats.throwHits > 0) out.push({ icon: 'arrow', title: 'Best arm', who: arm.name, detail: `${arm.stats.throwHits} of ${arm.stats.throws} throws landed` });
  const holder = best((p) => p.stats.timeHolding);
  if (holder.stats.timeHolding > 0.5) out.push({ icon: 'bomb', title: 'Held it longest', who: holder.name, detail: `${holder.stats.timeHolding.toFixed(1)}s with the bomb` });
  const clutch = best((p) => p.stats.closeCalls);
  if (clutch.stats.closeCalls > 0) out.push({ icon: 'clock', title: 'Closest shave', who: clutch.name, detail: `${clutch.stats.closeCalls} pass${clutch.stats.closeCalls === 1 ? '' : 'es'} with the fuse nearly out` });
  return out;
}

export function Results({ session, onRematch, onMenu, onVerify }: { session: SessionLike; onRematch: () => void; onMenu: () => void; onVerify: () => void }) {
  const s = session.state;
  const ranked = [...s.players].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99));
  const winner = ranked[0];
  const localWon = winner.id === session.localId;
  const local = s.players.find((p) => p.id === session.localId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' || e.code === 'Enter') onRematch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRematch]);

  // podium order on screen: 2nd, 1st, 3rd
  const podium = [ranked[1], ranked[0], ranked[2]];
  const place = ['second', 'first', 'third'];
  const num = ['2', '1', '3'];
  const medal = ['silver', 'gold', 'bronze'];
  // Star rating for your own finish: 3 for a win, 2 for second, 1 for third.
  const honours = awards(s.players);
  const stars = local?.placement ? Math.max(0, 4 - local.placement) : 0;

  return (
    <div className="modal-backdrop">
      <div className="panel results">
        <img className="results-stars" src={`${import.meta.env.BASE_URL}ui/stars-${stars}.webp`} alt={`${stars} of 3 stars`} draggable={false} />
        <h2 className="ribbon">{localWon ? 'Victory' : 'Match over'}</h2>
        <div className="results-title">{localWon ? 'Last one standing' : `${winner.name} takes it`}</div>
        <div className="results-sub">
          {localWon ? 'You outlasted the whole crew' : local?.placement ? `You finished ${ordinal(local.placement)}` : 'The last one standing'} · {Math.round(s.time)}s
        </div>

        <div className="podium">
          {podium.map((p, i) =>
            p ? (
              <div key={p.id} className={`step ${place[i]} ${p.id === session.localId ? 'is-local' : ''}`}>
                <div className="step-who">
                  <Portrait id={p.character} bot={p.isBot} seat={s.players.indexOf(p)} size={i === 1 ? 84 : 64} className="step-badge" />
                </div>
                <div className="step-block">
                  <span className={`medal ${medal[i]}`}>{num[i]}</span>
                  <span className="step-name">{p.name}</span>
                </div>
              </div>
            ) : (
              <div key={i} />
            ),
          )}
        </div>

        {ranked.length > 3 && (
          <div className="rest">
            {ranked.slice(3).map((p) => (
              <span key={p.id} className={p.id === session.localId ? 'is-local' : ''}>
                {ordinal(p.placement ?? 6)} {p.name}
              </span>
            ))}
          </div>
        )}

        {honours.length > 0 && (
          <div className="awards sheet">
            {honours.map((a) => (
              <div className="award" key={a.title}>
                <Icon name={a.icon} size={26} />
                <div>
                  <b>{a.title}</b>
                  <small>
                    {a.who}, {a.detail}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="row">
          <button className="btn primary big" onClick={onRematch}>
            Rematch <kbd>R</kbd>
          </button>
          <button className="btn" onClick={onVerify}>
            Match details
          </button>
          <button className="btn plank" onClick={onMenu}>
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}

function ordinal(n: number) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}
