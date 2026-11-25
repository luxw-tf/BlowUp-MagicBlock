import { useEffect, useRef, useState } from 'react';
import { guestKeys, OnlineSession, type LobbyMatchInfo } from '../chain/online-session';
import type { Profile } from '../state/settings';

/** Lobby service base URL: same origin in dev (Vite proxies /api). */
export const LOBBY_URL: string = (import.meta.env.VITE_LOBBY_URL as string | undefined) ?? '';

const STEPS: { status: string; label: string }[] = [
  { status: 'creating', label: 'reserving an arena' },
  { status: 'delegating', label: 'opening the rollup' },
  { status: 'starting', label: 'drawing the first bomb holder' },
];

/**
 * Online quick play: asks the lobby service for a match (it sponsors all
 * setup, so the guest needs no wallet or SOL), then hands off to an
 * OnlineSession once the match is live on the rollup.
 */
export function OnlineLobby({ profile, onReady, onCancel }: { profile: Profile; onReady: (s: OnlineSession) => void; onCancel: () => void }) {
  const [status, setStatus] = useState('requesting');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<LobbyMatchInfo | null>(null);
  const done = useRef(false);
  // One request per lobby visit. Refs survive StrictMode's simulated
  // remount, so the dev double-effect can't create two matches.
  const keysRef = useRef<ReturnType<typeof guestKeys> | null>(null);
  const request = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    keysRef.current ??= guestKeys();
    const keys = keysRef.current;
    request.current ??= (async () => {
      const res = await fetch(`${LOBBY_URL}/api/quickplay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: profile.name,
          character: profile.character,
          identity: keys.identity.publicKey.toBase58(),
          session: keys.session.publicKey.toBase58(),
          sessionExpiry: keys.sessionExpiry,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `lobby error ${res.status}`);
      return body.id as string;
    })();
    (async () => {
      const id = await request.current!;
      while (!cancelled) {
        const m = (await (await fetch(`${LOBBY_URL}/api/matches/${id}`)).json()) as LobbyMatchInfo;
        setStatus(m.status);
        setInfo(m);
        if (m.status === 'error') throw new Error(m.error ?? 'match setup failed');
        if ((m.status === 'starting' || m.status === 'live') && m.erUrl && !done.current) {
          done.current = true;
          onReady(new OnlineSession(m, keys.session, LOBBY_URL));
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })().catch((e: Error) => {
      if (!cancelled) setError(e.message.includes('fetch') ? 'Lobby service unreachable. Is `npm run server` running?' : e.message);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepIndex = STEPS.findIndex((s) => s.status === status);

  return (
    <div className="screen lobby">
      <div className="panel lobby-panel">
        <div className="lobby-head">
          <h2>{error ? 'could not start' : 'joining online match'}</h2>
          <span className="room-code">devnet</span>
        </div>
        {error ? (
          <p className="verify-status warn">{error}</p>
        ) : (
          <div className="slots">
            {STEPS.map((s, i) => (
              <div key={s.status} className={`slot-row ${i <= stepIndex ? 'on' : ''}`}>
                {i < stepIndex ? <span className="ready">✓</span> : i === stepIndex ? <span className="spinner" /> : <span className="dim">·</span>}
                <span className="slot-name">{s.label}</span>
              </div>
            ))}
            {info && info.roster.length > 0 && (
              <p className="fine">
                {info.roster.filter((r) => r.isBot).length} bots filled the lobby · no wallet needed
              </p>
            )}
          </div>
        )}
        <div className="row">
          <button className="btn ghost" onClick={onCancel}>
            {error ? 'Back' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
