import { useEffect, useState } from 'react';
import { browserWallets, readWalletProfile } from '../chain/browser-wallet';
import type { WalletProof } from '../chain/wallet-link';

type Wallet = ReturnType<typeof browserWallets>[number];
type Stats = Awaited<ReturnType<typeof readWalletProfile>>;

export function WalletProgress({ proof, connect, guest, busy, error }: {
  proof: WalletProof | null;
  connect: (provider: Wallet['provider']) => void;
  guest: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [choosing, setChoosing] = useState(false);
  const [stats, setStats] = useState<Stats>();
  const [readError, setReadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const address = proof?.wallet;

  useEffect(() => {
    setStats(undefined);
    setReadError(false);
    if (!address) return;
    let cancelled = false;
    readWalletProfile(address).then(
      (profile) => { if (!cancelled) setStats(profile); },
      () => { if (!cancelled) setReadError(true); },
    );
    return () => { cancelled = true; };
  }, [address, refresh]);

  const wallets = choosing ? browserWallets() : [];
  return (
    <div className="wallet-progress">
      <div className="wallet-actions">
        {address && <span title={address}>{address.slice(0, 5)}…{address.slice(-4)}</span>}
        <button type="button" aria-expanded={choosing} disabled={busy} onClick={() => setChoosing(!choosing)}>
          {busy ? 'Waiting for wallet…' : address ? 'Link wallet again' : 'Connect wallet'}
        </button>
        {address ? (
          <button type="button" disabled={busy} onClick={() => { guest(); setChoosing(false); }}>Play as guest</button>
        ) : <span>Playing as a guest</span>}
      </div>
      {choosing && (
        <div className="wallet-actions">
          {wallets.map(({ name, provider }) => (
            <button type="button" key={name} disabled={busy} onClick={() => { setChoosing(false); connect(provider); }}>{name}</button>
          ))}
          {!wallets.length && <p>Install Phantom, Solflare or Backpack to link your progress.</p>}
        </div>
      )}
      {error && <p role="status">{error}</p>}
      {address && (
        <details>
          <summary>Online progress</summary>
          {readError ? <p>Could not load progress.</p> : stats === undefined ? <p>Loading progress…</p> : (
            <dl>
              <div><dt>Matches</dt><dd>{stats?.matches ?? 0}</dd></div>
              <div><dt>Wins</dt><dd>{stats?.wins ?? 0}</dd></div>
              <div><dt>Podiums</dt><dd>{stats?.podiums ?? 0}</dd></div>
              <div><dt>Passes</dt><dd>{stats?.passes ?? 0}</dd></div>
              <div><dt>Bombs received</dt><dd>{stats?.received ?? 0}</dd></div>
            </dl>
          )}
          <button type="button" onClick={() => setRefresh(refresh + 1)}>Refresh progress</button>
        </details>
      )}
    </div>
  );
}
