import { useEffect, useState } from 'react';
import type { GameSession } from '../game/session';
import { getPlayer } from '../game/sim';

/**
 * Optional verification panel (PRD §10/§12). The only place technical
 * randomness details are surfaced. Until MagicBlock VRF is integrated it is
 * explicit that the values are local and NOT verifiable.
 */
export function VerificationPanel({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const s = session.state;
  const verifiable = session.provider.verifiable;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel verify">
        <h2>Match details</h2>
        <div className={`verify-status ${verifiable ? 'ok' : 'warn'}`}>
          {verifiable ? (
            <>Randomness source: {session.provider.label}</>
          ) : (
            <>
              <b>Not verifiable.</b> This match used {session.provider.label}. Bomb holders, fuse lengths and item rewards are drawn from explicit
              randomness requests, but on-chain verification (MagicBlock VRF + Solana settlement) is not integrated yet.
            </>
          )}
        </div>
        <div className="verify-meta">
          tick {s.tick} · {s.randomRequests.length} request(s) pending
        </div>
        <div className="verify-scroll">
          <table className="verify-table">
            <thead>
              <tr>
                <th>#</th>
                <th>purpose</th>
                <th>subject</th>
                <th>value</th>
                <th>latency</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {[...session.verification].reverse().map((v) => (
                <tr key={v.requestId}>
                  <td>{v.requestId}</td>
                  <td>{v.purpose}</td>
                  <td>{v.subject ? getPlayer(s, v.subject)?.name : '—'}</td>
                  <td className="mono" title={v.valueHex}>
                    {v.valueHex ? `${v.valueHex.slice(0, 16)}…` : 'pending'}
                  </td>
                  <td>{v.valueHex ? `${Math.round(v.latencyMs)}ms` : '—'}</td>
                  <td>{v.valueHex ? (v.applied ? 'applied' : 'discarded (stale)') : v.attempts > 1 ? `retry ${v.attempts}` : 'pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
