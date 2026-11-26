import { useEffect, useMemo, useState } from 'react';
import { characterDef } from '../game/content';
import type { SessionLike } from '../game/sessionTypes';
import { Icon, type IconName } from './Icon';
import { Portrait } from './Portrait';
import { verdict } from './brainrot';

type P = SessionLike['state']['players'][number];

/** A few honours from the match stats. Only awarded for a real feat (one tag or one hit isn't one). */
function awards(players: P[]): { icon: IconName; title: string; who: P; value: string; unit: string }[] {
  const best = (f: (p: P) => number) => players.reduce((a, b) => (f(b) > f(a) ? b : a));
  const out: { icon: IconName; title: string; who: P; value: string; unit: string }[] = [];
  const tagger = best((p) => p.stats.tags);
  if (tagger.stats.tags >= 2) out.push({ icon: 'dash', title: 'Fastest hands in Ohio', who: tagger, value: `${tagger.stats.tags}`, unit: 'tags' });
  const arm = best((p) => p.stats.throwHits);
  if (arm.stats.throwHits >= 2) out.push({ icon: 'arrow', title: 'Aimbot (allegedly)', who: arm, value: `${arm.stats.throwHits}/${arm.stats.throws}`, unit: 'throws landed' });
  const holder = best((p) => p.stats.timeHolding);
  if (holder.stats.timeHolding >= 5) out.push({ icon: 'bomb', title: 'Bomb hoarder', who: holder, value: `${holder.stats.timeHolding.toFixed(1)}s`, unit: 'holding it' });
  const clutch = best((p) => p.stats.closeCalls);
  if (clutch.stats.closeCalls > 0) out.push({ icon: 'clock', title: 'Plot armour', who: clutch, value: `${clutch.stats.closeCalls}`, unit: clutch.stats.closeCalls === 1 ? 'pass at the last second' : 'passes at the last second' });
  return out;
}

/**
 * The end of a match, laid out like a game's victory screen: a big banner over a burst of light and confetti, the top
 * three standing on a stepped podium (the winner crowned), everyone else in a ranked list with your own row picked out,
 * the match's honours as tiles, and three chunky buttons with Rematch leading. It floats over the dimmed dock.
 */
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

  const seat = (p: P) => s.players.indexOf(p);
  const lasted = (p: P) => (p.id === winner.id ? 'last one standing' : p.eliminatedAt !== null ? `out after ${Math.round(p.eliminatedAt)}s` : '');
  // Star rating for your own finish: 3 for a win, 2 for second, 1 for third; none shown below the podium.
  const stars = local?.placement ? Math.max(0, 4 - local.placement) : 0;
  const honours = awards(s.players);
  // confetti in the winner's colour, gold and cream: positions fixed once so it doesn't reshuffle on re-render
  const confetti = useMemo(() => {
    const c = characterDef(winner.character).color;
    return Array.from({ length: 28 }, (_, i) => ({
      x: (i * 37) % 100,
      delay: ((i * 53) % 100) / 100,
      dur: 2.2 + ((i * 29) % 10) / 10,
      rot: (i * 47) % 360,
      color: [c, '#f4b63a', '#fff4dc', c, '#e8713c'][i % 5],
    }));
  }, [winner.character]);

  // podium order on screen: 2nd, 1st, 3rd
  const podium = [ranked[1], ranked[0], ranked[2]];
  const place = ['second', 'first', 'third'];
  const medal = ['silver', 'gold', 'bronze'];

  return (
    <div className="modal-backdrop results-backdrop">
      <div className="confetti" aria-hidden>
        {confetti.map((k, i) => (
          <i key={i} style={{ left: `${k.x}%`, background: k.color, animationDelay: `${k.delay}s`, animationDuration: `${k.dur}s`, '--rot': `${k.rot}deg` } as React.CSSProperties} />
        ))}
      </div>

      <div className="results2">
        {stars > 0 && <img className="r-stars" src={`${import.meta.env.BASE_URL}ui/stars-${stars}.webp`} alt={`${stars} of 3 stars`} draggable={false} />}
        <h2 className="ribbon r-banner">{localWon ? 'Victory!' : 'Match over'}</h2>
        <div className="r-title">{localWon ? 'You outlasted the whole crew' : `${winner.name} wins`}</div>

        {/* the top three, standing on a stepped podium */}
        <div className="r-podium">
          {podium.map((p, i) =>
            p ? (
              <div key={p.id} className={`r-step ${place[i]} ${p.id === session.localId ? 'is-local' : ''}`} style={{ '--c': characterDef(p.character).color } as React.CSSProperties}>
                <div className="r-who">
                  {i === 1 && (
                    <span className="r-crown">
                      <Icon name="crown" size={36} fill="#f4b63a" />
                    </span>
                  )}
                  <Portrait id={p.character} bot={p.isBot} seat={seat(p)} size={i === 1 ? 80 : 60} />
                </div>
                <div className="r-name">
                  {p.id === session.localId ? 'You' : p.name}
                </div>
                <div className="r-block">
                  <span className={`medal ${medal[i]}`}>{i === 1 ? 1 : i === 0 ? 2 : 3}</span>
                  <small>{lasted(p)}</small>
                </div>
              </div>
            ) : (
              <div key={i} />
            ),
          )}
        </div>

        {/* everyone else, ranked; your row picked out */}
        {ranked.length > 3 && (
          <div className="r-list">
            {ranked.slice(3).map((p) => (
              <div key={p.id} className={`r-row ${p.id === session.localId ? 'is-local' : ''}`} style={{ '--c': characterDef(p.character).color } as React.CSSProperties}>
                <b className="r-rank">{p.placement ?? '—'}</b>
                <Portrait id={p.character} bot={p.isBot} seat={seat(p)} size={30} />
                <span className="r-row-name">{p.id === session.localId ? 'You' : p.name}</span>
                <span className="r-row-stat">{lasted(p)}</span>
              </div>
            ))}
          </div>
        )}

        {/* the roast, by your place */}
        {local && <div className="r-verdict">{verdict(local.placement)}</div>}

        {/* the match's honours, as tiles */}
        {honours.length > 0 && (
          <div className="r-awards">
            {honours.map((a) => (
              <div className="r-award" key={a.title}>
                <span className="award-badge">
                  <Icon name={a.icon} size={20} />
                </span>
                <b>{a.title}</b>
                <span className="r-award-line">
                  <span className="r-award-val">
                    {a.value}
                    <small>{a.unit}</small>
                  </span>
                  <span className="r-award-who">
                    <Portrait id={a.who.character} bot={a.who.isBot} seat={seat(a.who)} size={18} />
                    {a.who.id === session.localId ? 'You' : a.who.name}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="r-actions">
          <button className="btn quiet" onClick={onMenu}>
            Menu
          </button>
          <button className="btn" onClick={onVerify}>
            Match details
          </button>
          <button className="btn primary big" onClick={onRematch}>
            Rematch <kbd>R</kbd>
          </button>
        </div>
        <div className="r-foot">{endTime}s match</div>
      </div>
    </div>
  );
}
