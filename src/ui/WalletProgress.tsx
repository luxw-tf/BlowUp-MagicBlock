import { useEffect, useRef, useState } from 'react';
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
  const picker = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (choosing && !picker.current?.open) picker.current?.showModal();
  }, [choosing]);
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

  const wallets = browserWallets();
  const linked = wallets.find(w => address && w.provider.publicKey?.toBase58() === address);
  const [icons, setIcons] = useState<Record<string,string>>({});
  useEffect(() => {
    // Read brand artwork advertised by installed Wallet Standard extensions.
    const register = (...wallets: {name: string; icon: string}[]) => {
      const known = wallets.filter(w => ['Phantom','Solflare','Backpack'].includes(w.name) && w.icon?.startsWith('data:image/'));
      if (known.length) setIcons(previous => ({...previous, ...Object.fromEntries(known.map(w => [w.name,w.icon]))}));
      return () => {};
    };
    const api = {register};
    const onRegister = (e: Event) => {
      const callback = (e as CustomEvent).detail;
      if (typeof callback === 'function') callback(api);
    };
    window.addEventListener('wallet-standard:register-wallet', onRegister);
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {detail:api}));
    return () => window.removeEventListener('wallet-standard:register-wallet', onRegister);
  }, []);
  return (
    <div className="wallet-progress">
      <div className="wallet-line">
        {linked && icons[linked.name] && <img src={icons[linked.name]} width="24" height="24" alt="" />}
        <div className="wallet-copy"><strong>{address ? linked?.name ?? 'Linked wallet' : 'Save your wins'}</strong>
          <small title={address}>{address ? address.slice(0,5) + '…' + address.slice(-4) : 'Link a wallet to track online matches.'}</small></div>
        <button type="button" aria-expanded={choosing} disabled={busy} onClick={() => setChoosing(!choosing)}>
          {busy ? 'Signing…' : address ? 'Manage' : 'Connect wallet'}
        </button>
      </div>
      {choosing && <dialog ref={picker} className="wallet-dialog" aria-labelledby="wallet-title" onClose={() => setChoosing(false)}>
        <header><h2 id="wallet-title">{address ? 'Manage wallet' : 'Choose a wallet'}</h2>
          <button aria-label="Close wallet picker" type="button" onClick={() => picker.current?.close()}>×</button></header>
        <div className="wallet-picker">
        {(wallets.length ? wallets.map(w => w.name) : ['Phantom','Solflare','Backpack']).map(name => {
          const wallet = wallets.find(w => w.name === name);
          return <button key={name} type="button" disabled={busy || !wallet} onClick={() => {
            if (wallet) { setChoosing(false); connect(wallet.provider); }
          }}>
            {icons[name] && <img src={icons[name]} width="20" height="20" alt="" />}
            {name}<small>{wallet ? 'Connect' : 'Not detected'}</small>
          </button>;
        })}
        {!wallets.length && <p>Open the game in a browser with a supported wallet to connect.</p>}
        {address && <button type="button" disabled={busy} onClick={() => { guest(); setChoosing(false); }}>Continue as guest</button>}
      </div></dialog>}
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
