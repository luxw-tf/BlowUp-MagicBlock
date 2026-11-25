import { useEffect, useRef, useState } from 'react';
import { guestKeys, type OnlineSession } from '../chain/online-session';
import type { Profile } from '../state/settings';
import { api, joinPayload, SETUP_STEPS, waitForMatch, type GuestKeys } from './onlineFlow';

interface TicketView {
  status: 'queued' | 'matched' | 'cancelled' | 'room';
  matchId: string | null;
  queued: number;
  fillInMs: number;
}

/**
 * Online quick play: join the queue (humans are grouped first; bots fill the
 * remaining seats after a short window), then wait for the match to go live
 * on the rollup. The lobby sponsors everything, so no wallet or SOL.
 */
export function OnlineLobby({ profile, onReady, onCancel }: { profile: Profile; onReady: (s: OnlineSession) => void; onCancel: () => void }) {
  const [status, setStatus] = useState('queued');
  const [queue, setQueue] = useState<TicketView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One request per lobby visit; refs survive StrictMode's simulated remount.
  const keysRef = useRef<GuestKeys | null>(null);
  const ticket = useRef<Promise<string> | null>(null);
  const handedOff = useRef(false);

  useEffect(() => {
    let cancelled = false;
    keysRef.current ??= guestKeys();
    const keys = keysRef.current;
    ticket.current ??= api<{ ticket: string }>('/api/quickplay', { body: joinPayload(profile, keys) }).then((r) => r.ticket);
    (async () => {
      const t = await ticket.current!;
      let matchId: string | null = null;
      while (!cancelled && !matchId) {
        const v = await api<TicketView>(`/api/tickets/${t}`);
        setQueue(v);
        if (v.status === 'cancelled') throw new Error('Left the queue.');
        matchId = v.matchId;
        if (!matchId) await new Promise((r) => setTimeout(r, 500));
      }
      if (!matchId) return;
      setStatus('creating');
      const session = await waitForMatch(matchId, keys, () => cancelled, setStatus);
      if (session && !handedOff.current) {
        handedOff.current = true;
        onReady(session);
      }
    })().catch((e: Error) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    void ticket.current?.then((t) => api(`/api/tickets/${t}`, { method: 'DELETE' })).catch(() => {});
    onCancel();
  };

  const stepIndex = SETUP_STEPS.findIndex((s) => s.status === status);
  const inQueue = status === 'queued';

  return (
    <div className="screen lobby">
      <div className="panel lobby-panel">
        <div className="lobby-head">
          <h2>{error ? 'could not start' : inQueue ? 'finding players…' : 'joining online match'}</h2>
          <span className="room-code">devnet</span>
        </div>
        {error ? (
          <p className="verify-status warn">{error}</p>
        ) : inQueue ? (
          <div className="slots">
            <div className="slot-row on">
              <span className="spinner" />
              <span className="slot-name">
                {queue ? `${queue.queued} player${queue.queued === 1 ? '' : 's'} in the queue` : 'joining the queue'}
              </span>
            </div>
            <p className="fine">
              {queue && queue.fillInMs > 0
                ? `Bots fill the empty seats in ${Math.ceil(queue.fillInMs / 1000)}s.`
                : 'Starting with who is here; bots fill the rest.'}
            </p>
          </div>
        ) : (
          <div className="slots">
            {SETUP_STEPS.map((s, i) => (
              <div key={s.status} className={`slot-row ${i <= stepIndex ? 'on' : ''}`}>
                {i < stepIndex ? <span className="ready">✓</span> : i === stepIndex ? <span className="spinner" /> : <span className="dim">·</span>}
                <span className="slot-name">{s.label}</span>
              </div>
            ))}
            <p className="fine">No wallet needed.</p>
          </div>
        )}
        <div className="row">
          <button className="btn ghost" onClick={cancel}>
            {error ? 'Back' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
