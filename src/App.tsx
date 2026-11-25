import { useCallback, useState } from 'react';
import { activeMatchId, rememberActiveMatch, type OnlineSession } from './chain/online-session';
import { buildParticipants, GameSession } from './game/session';
import type { SessionLike } from './game/sessionTypes';
import type { ParticipantSetup } from './game/sim';
import { GameView } from './ui/GameView';
import { Landing, Lobby } from './ui/Menus';
import { OnlineLobby } from './ui/OnlineLobby';
import { rejoinMatch } from './ui/onlineFlow';
import { RoomScreen } from './ui/RoomScreen';
import { loadProfile, saveProfile, type Profile } from './state/settings';
import { MenuStage } from './render/MenuStage';
import type { CharacterId } from './game/types';

type Screen =
  | { kind: 'landing' }
  | { kind: 'lobby'; participants: ParticipantSetup[] }
  | { kind: 'online-lobby'; profile: Profile; attempt: number }
  | { kind: 'room'; profile: Profile; code: string | null; attempt: number }
  | { kind: 'match'; session: SessionLike };

const params = new URLSearchParams(location.search);
/** Invite links: ?room=CODE */
const inviteCode = /^[A-Za-z0-9]{5}$/.test(params.get('room') ?? '') ? params.get('room')!.toUpperCase() : null;

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [pendingRoom, setPendingRoom] = useState<string | null>(inviteCode);
  const [rejoinId, setRejoinId] = useState<string | null>(activeMatchId);
  const [notice, setNotice] = useState<string | null>(null);
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
      if (prev.kind === 'match' && (next.kind !== 'match' || next.session !== prev.session)) prev.session.dispose();
      return next;
    });
  }, []);

  const startMatch = useCallback((participants: ParticipantSetup[]) => go({ kind: 'match', session: new GameSession(participants) }), [go]);

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

  const toMatch = useCallback((s: OnlineSession) => go({ kind: 'match', session: s }), [go]);
  const toLanding = useCallback(() => {
    setRejoinId(activeMatchId());
    go({ kind: 'landing' });
  }, [go]);

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
        />
      );
    else if (screen.kind === 'lobby')
      menu = <Lobby participants={screen.participants} onStart={() => startMatch(screen.participants)} onCancel={toLanding} />;
    else if (screen.kind === 'online-lobby') menu = <OnlineLobby key={screen.attempt} profile={screen.profile} onReady={toMatch} onCancel={toLanding} />;
    else menu = <RoomScreen key={screen.attempt} profile={screen.profile} initialCode={screen.code} onReady={toMatch} onCancel={toLanding} />;
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
