import { useEffect, useRef, useState } from 'react';
import { guestKeys, type OnlineSession } from '../chain/online-session';
import type { CharacterId } from '../game/types';
import type { Profile } from '../state/settings';
import { api, joinPayload, SETUP_STEPS, waitForMatch, type GuestKeys } from './onlineFlow';
import { Icon } from './Icon';
import { Portrait } from './Portrait';

interface RoomView {
  code: string;
  status: 'open' | 'started';
  botFill: boolean;
  matchId: string | null;
  members: { name: string; character: CharacterId; ready: boolean; host: boolean; you: boolean }[];
}

/**
 * Private room: create one (you're the host) or join with a code / invite
 * link. Everyone readies up; the host controls bot fill and starts.
 */
export function RoomScreen({
  profile,
  initialCode,
  onReady,
  onCancel,
}: {
  profile: Profile;
  initialCode: string | null;
  onReady: (s: OnlineSession) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState(initialCode ?? '');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const keys = useRef<GuestKeys | null>(null);
  const ticket = useRef<string | null>(null);
  const joining = useRef(false);
  const handedOff = useRef(false);

  const enter = async (mode: 'create' | 'join') => {
    if (joining.current) return;
    joining.current = true;
    setError(null);
    try {
      keys.current ??= guestKeys();
      const body = joinPayload(profile, keys.current);
      if (mode === 'create') {
        const r = await api<{ code: string; ticket: string }>('/api/rooms', { body });
        ticket.current = r.ticket;
        setCode(r.code);
      } else {
        const c = codeInput.trim().toUpperCase();
        const r = await api<{ ticket: string }>(`/api/rooms/${c}/join`, { body });
        ticket.current = r.ticket;
        setCode(c);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      joining.current = false;
    }
  };

  // Invite links (?room=CODE) join straight away.
  useEffect(() => {
    if (initialCode && !code) void enter('join');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the room; hand off once the host starts.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        const v = await api<RoomView>(`/api/rooms/${code}?ticket=${ticket.current}`);
        if (cancelled) return;
        setRoom(v);
        if (v.status === 'started' && v.matchId) {
          setSetup('creating');
          const s = await waitForMatch(v.matchId, keys.current!, () => cancelled, setSetup);
          if (s && !handedOff.current) {
            handedOff.current = true;
            onReady(s);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const post = (action: string, body: Record<string, unknown>) =>
    api(`/api/rooms/${code}/${action}`, { body: { ticket: ticket.current, ...body } }).catch((e: Error) => setError(e.message));

  const leave = () => {
    if (ticket.current && room?.status === 'open') void api(`/api/tickets/${ticket.current}`, { method: 'DELETE' }).catch(() => {});
    onCancel();
  };

  const me = room?.members.find((m) => m.you);
  const isHost = !!me?.host;
  const allReady = !!room && room.members.every((m) => m.ready);
  const enough = !!room && (room.botFill || room.members.length >= 2);
  const invite = code ? `${location.origin}${location.pathname}?room=${code}` : '';

  if (!code) {
    return (
      <div className="screen lobby">
        <div className="panel lobby-panel">
          <div className="lobby-head">
            <h2>private room</h2>
            <span className="room-code">devnet</span>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void enter('create')}>
              Create room
            </button>
          </div>
          <div className="row room-join">
            <input
              className="code-input"
              value={codeInput}
              maxLength={5}
              placeholder="CODE"
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && codeInput.length === 5 && void enter('join')}
            />
            <button className="btn" disabled={codeInput.trim().length !== 5} onClick={() => void enter('join')}>
              Join
            </button>
          </div>
          {error && <p className="verify-status warn">{error}</p>}
          <div className="row">
            <button className="btn ghost" onClick={onCancel}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepIndex = setup ? SETUP_STEPS.findIndex((s) => s.status === setup) : -1;

  return (
    <div className="screen lobby">
      <div className="panel lobby-panel">
        <div className="lobby-head">
          <h2>{setup ? 'starting match' : 'private room'}</h2>
          <span className="room-code big-code">{code}</span>
        </div>
        {!setup && (
          <div className="invite">
            <input readOnly value={invite} onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(invite);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
        <div className="slots">
          {room?.members.map((m, i) => (
            <div key={i} className="slot-row on">
              <Portrait id={m.character} size={38} />
              <span className="slot-name">
                {m.name}
                {m.host && <span className="bot-badge">HOST</span>}
                {m.you && <span className="you-badge">YOU</span>}
              </span>
              <span className={m.ready ? 'ready' : 'dim'}>{m.ready ? 'ready' : 'not ready'}</span>
            </div>
          ))}
          {room && room.botFill && room.members.length < 6 && (
            <div className="slot-row">
              <span className="dim">+ {6 - room.members.length} bot{6 - room.members.length === 1 ? '' : 's'} at start</span>
            </div>
          )}
        </div>
        {setup && (
          <div className="slots">
            {SETUP_STEPS.map((s, i) => (
              <div key={s.status} className={`slot-row ${i <= stepIndex ? 'on' : ''}`}>
                {i < stepIndex ? <span className="ready"><Icon name="check" size={16} /></span> : i === stepIndex ? <span className="spinner" /> : <span className="dim">·</span>}
                <span className="slot-name">{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {!setup && room && (
          <>
            <label className="setting toggle">
              <span>Fill empty seats with bots {isHost ? '' : '(host decides)'}</span>
              <input type="checkbox" checked={room.botFill} disabled={!isHost} onChange={(e) => void post('settings', { botFill: e.target.checked })} />
            </label>
            <div className="row">
              <button className={`btn ${me?.ready ? '' : 'primary'}`} onClick={() => void post('ready', { ready: !me?.ready })}>
                {me?.ready ? 'Not ready' : 'Ready'}
              </button>
              {isHost && (
                <button
                  className="btn primary"
                  disabled={!allReady || !enough}
                  title={!allReady ? 'Everyone must be ready' : !enough ? 'Need 2 players, or turn on bot fill' : ''}
                  onClick={() => void post('start', {})}
                >
                  Start
                </button>
              )}
            </div>
          </>
        )}
        {error && <p className="verify-status warn">{error}</p>}
        <div className="row">
          <button className="btn ghost" onClick={leave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
