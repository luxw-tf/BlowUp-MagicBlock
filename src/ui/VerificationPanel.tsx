import { useEffect, useState } from 'react';
import type { OnlineMatchInfo, SessionLike } from '../game/sessionTypes';
import { getPlayer } from '../game/sim';

/**
 * Optional verification panel (PRD §10/§12): the only place technical
 * randomness and settlement details are surfaced. Offline matches say plainly
 * they are not verifiable; online matches link the on-chain accounts.
 */
export function VerificationPanel({ session, onClose }: { session: SessionLike; onClose: () => void }) {
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
            <>
              Bomb holders and fuse lengths come from <b>{session.provider.label}</b>. Each draw is{' '}
              <code>sha256("blowup" ‖ tag ‖ randomness)</code> of the value below, so anyone can recompute it.
            </>
          ) : (
            <>
              <b>Not verifiable.</b> This match used {session.provider.label}. Bomb holders, fuse lengths and item rewards are drawn from explicit
              randomness requests, but this offline match is not on-chain. Play online for a verifiable match.
            </>
          )}
        </div>
        {session.online ? <OnlineDetails info={session.online} /> : (
          <div className="verify-meta">
            tick {s.tick} · {s.randomRequests.length} request(s) pending
          </div>
        )}
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
                  <td>{v.valueHex && v.latencyMs >= 0 ? `${Math.round(v.latencyMs)}ms` : '—'}</td>
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

const explorer = (kind: 'address' | 'tx', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

function OnlineDetails({ info }: { info: OnlineMatchInfo }) {
  const rows: [string, React.ReactNode][] = [
    ['network', info.network],
    [
      'program',
      <a href={explorer('address', info.programId)} target="_blank" rel="noreferrer" className="mono">
        {short(info.programId)}
      </a>,
    ],
    ['match account', <span className="mono" title={info.matchPda}>{short(info.matchPda)}</span>],
    ['rollup', <span className="mono">{info.erUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>],
    [
      'settlement',
      info.settlement === 'settled' && info.resultPda ? (
        <>
          recorded on Solana ·{' '}
          <a href={explorer('address', info.resultPda)} target="_blank" rel="noreferrer">
            result
          </a>{' '}
          ·{' '}
          {info.recordSig && (
            <a href={explorer('tx', info.recordSig)} target="_blank" rel="noreferrer">
              tx
            </a>
          )}
        </>
      ) : info.settlement === 'settling' ? (
        <>
          <span className="spinner" /> committing to Solana…
        </>
      ) : info.settlement === 'error' ? (
        <span className="dim">failed: {info.error}</span>
      ) : (
        'live on the rollup'
      ),
    ],
  ];
  return (
    <div className="verify-meta online-details">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="dim">{k}</span> {v}
        </div>
      ))}
    </div>
  );
}
