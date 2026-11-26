import { useEffect, useState } from 'react';
import type { SessionLike } from '../game/sessionTypes';
import { Icon, type IconName } from './Icon';
import { Portrait } from './Portrait';
import { verdict } from './brainrot';

type P = SessionLike['state']['players'][number];

/** A few honours from the match stats. Only awarded for a real feat (one tag or one hit isn't one). */
function awards(players: P[]): { icon: IconName; title: string; who: string; detail: string }[] {
  const best = (f: (p: P) => number) => players.reduce((a, b) => (f(b) > f(a) ? b : a));
  const out: { icon: IconName; title: string; who: string; detail: string }[] = [];
  const tagger = best((p) => p.stats.tags);
  if (tagger.stats.tags >= 2) out.push({ icon: 'dash', title: 'Fastest hands in Ohio', who: tagger.name, detail: `${tagger.stats.tags} tag${tagger.stats.tags === 1 ? '' : 's'}` });
  const arm = best((p) => p.stats.throwHits);
  if (arm.stats.throwHits >= 2) out.push({ icon: 'arrow', title: 'Aimbot (allegedly)', who: arm.name, detail: `${arm.stats.throwHits} of ${arm.stats.throws} throws landed` });
  const holder = best((p) => p.stats.timeHolding);
  if (holder.stats.timeHolding >= 5) out.push({ icon: 'bomb', title: 'Bomb hoarder', who: holder.name, detail: `${holder.stats.timeHolding.toFixed(1)}s with the bomb` });
  const clutch = best((p) => p.stats.closeCalls);
  if (clutch.stats.closeCalls > 0) out.push({ icon: 'clock', title: 'Plot armour', who: clutch.name, detail: `${clutch.stats.closeCalls} pass${clutch.stats.closeCalls === 1 ? '' : 'es'} with the fuse nearly out` });
  return out;
}

export function Results({ session, onRematch, onMenu, onVerify }: { session: SessionLike; onRematch: () => void; onMenu: () => void; onVerify: () => void }) {
  const s = session.state;
  const ranked = [...s.players].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99));
  const winner = ranked[0];
  const localWon = winner.id === session.localId;
  const local = s.players.find((p) => p.id === session.localId);
  // the match keeps ticking behind the panel; the time shown is when it ended
  const [endTime] = useState(() => Math.round(s.time));

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
        {/* stars only when you earned some (a podium finish): three empty stars just read as a zero */}
        {stars > 0 && <img className="results-stars" src={`${import.meta.env.BASE_URL}ui/stars-${stars}.webp`} alt={`${stars} of 3 stars`} draggable={false} />}
        <h2 className={`ribbon ${stars > 0 ? '' : 'no-stars'}`}>{localWon ? 'Victory' : 'Match over'}</h2>
        <div className="results-title">{localWon ? 'Last one standing' : `${winner.name} takes it`}</div>
        {/* your own result, front and centre: your face, your place, how long you lasted */}
        {local && (
          <div className={`results-you ${local.placement && local.placement <= 3 ? 'podium-finish' : ''}`}>
            <Portrait id={local.character} bot={local.isBot} seat={s.players.indexOf(local)} size={48} />
            <div className="you-place">
              <b>{local.placement ? ordinal(local.placement) : '—'}</b>
              <span>
                of {s.players.length} · {localWon ? `won in ${endTime}s` : local.eliminatedAt !== null ? `out after ${Math.round(local.eliminatedAt)}s` : `${endTime}s`}
              </span>
            </div>
            <div className="results-verdict">{verdict(local.placement)}</div>
          </div>
        )}

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
              <span key={p.id} className={`rest-chip ${p.id === session.localId ? 'is-local' : ''}`}>
                <em>{ordinal(p.placement ?? 6)}</em>
                <Portrait id={p.character} bot={p.isBot} seat={s.players.indexOf(p)} size={24} />
                {p.name}
              </span>
            ))}
          </div>
        )}

        {honours.length > 0 && (
          <div className="awards sheet">
            {honours.map((a) => (
              <div className="award" key={a.title}>
                <span className="award-badge">
                  <Icon name={a.icon} size={20} />
                </span>
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
          <button className="btn quiet" onClick={onMenu}>
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
