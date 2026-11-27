import { useCallback, useEffect, useState } from 'react';
import { activeMatchId, rememberActiveMatch, type OnlineSession } from './chain/online-session';
import { buildParticipants, GameSession } from './game/session';
import type { SessionLike } from './game/sessionTypes';
import type { ParticipantSetup } from './game/sim';
import { GameView } from './ui/GameView';
import { Landing, Lobby } from './ui/Menus';
import { OnlineLobby } from './ui/OnlineLobby';
import { rejoinMatch } from './ui/onlineFlow';
import { RoomScreen } from './ui/RoomScreen';
import { createTutorialSession, TutorialCoach } from './ui/Tutorial';
import type { GameSession as LocalSession } from './game/session';
import { loadProfile, saveProfile, type Profile } from './state/settings';
import { MenuStage } from './render/MenuStage';
import type { CharacterId } from './game/types';
import { browserWallets, loadWalletLink, saveWalletLink, signWalletLink, WALLET_LINK_KEY, walletLinkExpiresAt, watchWallet, type SavedWalletLink } from './chain/browser-wallet';
import type { MapSelection } from './game/arena';
import { WalletProgress } from './ui/WalletProgress';

type Screen =
  | { kind: 'landing' }
  | { kind: 'lobby'; participants: ParticipantSetup[] }
  | { kind: 'online-lobby'; profile: Profile; attempt: number }
  | { kind: 'room'; profile: Profile; code: string | null; attempt: number }
  | { kind: 'match'; session: SessionLike }
  | { kind: 'tutorial'; session: LocalSession };

const params = new URLSearchParams(location.search);
/** Invite links: ?room=CODE */
const inviteCode = /^[A-Za-z0-9]{5}$/.test(params.get('room') ?? '') ? params.get('room')!.toUpperCase() : null;

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [pendingRoom, setPendingRoom] = useState<string | null>(inviteCode);
  const [rejoinId, setRejoinId] = useState<string | null>(activeMatchId);
  const [notice, setNotice] = useState<string | null>(null);
  const [linked, setLinked] = useState(loadWalletLink);
  const [map, setMap] = useState<MapSelection>({});
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const walletProof = linked?.proof ?? null;
  const storeLink = useCallback((link: SavedWalletLink | null) => {
    saveWalletLink(link);
    setLinked(link);
  }, []);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === WALLET_LINK_KEY || e.key === null) setLinked(loadWalletLink());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!linked) return;
    const provider = browserWallets().find((wallet) => wallet.name === linked.providerName)?.provider;
    const clear = () => storeLink(null);
    if (provider?.publicKey && provider.publicKey.toBase58() !== linked.proof.wallet) {
      clear();
      return;
    }
    const unsubscribe = provider && watchWallet(provider, linked.proof.wallet, clear);
    const expiration = window.setTimeout(clear, Math.max(0, walletLinkExpiresAt(linked.proof) - Date.now()));
    return () => {
      unsubscribe?.();
      window.clearTimeout(expiration);
    };
  }, [linked, storeLink]);

  const connectWallet = async (provider: Parameters<typeof signWalletLink>[0]) => {
    setWalletBusy(true);
    setWalletError(null);
    try {
      const providerName = browserWallets().find((wallet) => wallet.provider === provider)?.name;
      if (!providerName) throw new Error('Wallet provider unavailable.');
      storeLink({ proof: await signWalletLink(provider), providerName });
    } catch {
      setWalletError('Could not link wallet. Try again or play as a guest.');
    } finally {
      setWalletBusy(false);
    }
  };
  /** the pirate standing on the menu's dock */
  const [hero, setHero] = useState<CharacterId>(() => loadProfile()?.character ?? 'frog');
  const [screen, setScreen] = useState<Screen>(() =>
    // Dev shortcut: ?quick jumps straight into a match.
    params.has('quick')
      ? { kind: 'match', session: new GameSession(buildParticipants(loadProfile() ?? { name: 'dev', character: 'frog' })) }
      : { kind: 'landing' },
  );

  /**
   * Switch screens, disposing the outgoing match session. Done here rather
   * than in an effect cleanup, which StrictMode runs on mount.
   */
  const go = useCallback((next: Screen) => {
    setScreen((prev) => {
      if ((prev.kind === 'match' || prev.kind === 'tutorial') && (!('session' in next) || next.session !== prev.session)) prev.session.dispose();
      return next;
    });
  }, []);

  const startMatch = useCallback((participants: ParticipantSetup[]) => go({ kind: 'match', session: new GameSession(participants, undefined, map) }), [go, map]);

  const remember = useCallback((p: Profile) => {
    setProfile(p);
    saveProfile(p);
  }, []);

  const quickPlay = useCallback(
    (p: Profile) => {
      remember(p);
      go({ kind: 'lobby', participants: buildParticipants(p) });
    },
    [go, remember],
  );

  const playOnline = useCallback(
    (p: Profile) => {
      remember(p);
      go({ kind: 'online-lobby', profile: p, attempt: Date.now() });
    },
    [go, remember],
  );

  const privateRoom = useCallback(
    (p: Profile, code: string | null = null) => {
      remember(p);
      setPendingRoom(null);
      if (code) history.replaceState(null, '', location.pathname);
      go({ kind: 'room', profile: p, code, attempt: Date.now() });
    },
    [go, remember],
  );

  const rejoin = useCallback(() => {
    if (!rejoinId) return;
    rejoinMatch(rejoinId)
      .then((s) => go({ kind: 'match', session: s }))
      .catch((e: Error) => {
        rememberActiveMatch(null);
        setRejoinId(null);
        setNotice(e.message);
      });
  }, [go, rejoinId]);

  const tutorial = useCallback(
    (p: Profile) => {
      remember(p);
      go({ kind: 'tutorial', session: createTutorialSession(p) });
    },
    [go, remember],
  );

  const toMatch = useCallback((s: OnlineSession) => go({ kind: 'match', session: s }), [go]);
  const toLanding = useCallback(() => {
    setRejoinId(activeMatchId());
    go({ kind: 'landing' });
  }, [go]);

  if (screen.kind === 'tutorial')
    return (
      <>
        <GameView key={screen.session.id} session={screen.session} onRematch={() => tutorial(profile ?? { name: 'guest', character: 'frog' })} onMenu={toLanding} />
        <TutorialCoach
          session={screen.session}
          onPlay={() => quickPlay(profile ?? { name: 'guest', character: 'frog' })}
          onExit={toLanding}
        />
      </>
    );

  if (screen.kind !== 'match') {
    let menu;
    if (screen.kind === 'landing')
      menu = (
        <Landing
          initial={profile}
          onPlay={quickPlay}
          onPlayOnline={playOnline}
          onPrivateRoom={(p) => privateRoom(p, pendingRoom)}
          pendingRoom={pendingRoom}
          onRejoin={rejoinId ? rejoin : null}
          notice={notice}
          onCharacter={setHero}
          onTutorial={tutorial}
          map={map}
          onMap={setMap}
          onProfileChange={remember}
          walletControls={<WalletProgress proof={walletProof} connect={connectWallet} guest={() => { storeLink(null); setWalletError(null); }} busy={walletBusy} error={walletError} />}
        />
      );
    else if (screen.kind === 'lobby')
      menu = <Lobby participants={screen.participants} onStart={() => startMatch(screen.participants)} onCancel={toLanding} />;
    else if (screen.kind === 'online-lobby') menu = <OnlineLobby key={screen.attempt} profile={screen.profile} walletProof={walletProof} map={map} onReady={toMatch} onCancel={toLanding} />;
    else menu = <RoomScreen key={screen.attempt} profile={screen.profile} walletProof={walletProof} map={map} initialCode={screen.code} onReady={toMatch} onCancel={toLanding} />;
    return (
      <>
        <MenuStage hero={hero} />
        {menu}
      </>
    );
  }

  const online = screen.session.online !== null;
  return (
    <GameView
      key={screen.session.id}
      session={screen.session}
      onRematch={() =>
        online
          ? playOnline(profile ?? { name: 'guest', character: 'frog' })
          : startMatch(buildParticipants(profile ?? { name: 'guest', character: 'frog' }))
      }
      onMenu={toLanding}
    />
  );
}
