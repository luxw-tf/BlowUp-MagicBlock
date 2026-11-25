import { useCallback, useState } from 'react';
import type { OnlineSession } from './chain/online-session';
import { buildParticipants, GameSession } from './game/session';
import type { SessionLike } from './game/sessionTypes';
import type { ParticipantSetup } from './game/sim';
import { GameView } from './ui/GameView';
import { Landing, Lobby } from './ui/Menus';
import { OnlineLobby } from './ui/OnlineLobby';
import { loadProfile, saveProfile, type Profile } from './state/settings';

type Screen =
  | { kind: 'landing' }
  | { kind: 'lobby'; participants: ParticipantSetup[] }
  | { kind: 'online-lobby'; profile: Profile; attempt: number }
  | { kind: 'match'; session: SessionLike };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [screen, setScreen] = useState<Screen>(() =>
    // Dev shortcut: ?quick jumps straight into a match.
    new URLSearchParams(location.search).has('quick')
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

  if (screen.kind === 'landing') return <Landing initial={profile} onPlay={quickPlay} onPlayOnline={playOnline} />;
  if (screen.kind === 'lobby')
    return <Lobby participants={screen.participants} onStart={() => startMatch(screen.participants)} onCancel={() => go({ kind: 'landing' })} />;
  if (screen.kind === 'online-lobby')
    return (
      <OnlineLobby
        key={screen.attempt}
        profile={screen.profile}
        onReady={(s: OnlineSession) => go({ kind: 'match', session: s })}
        onCancel={() => go({ kind: 'landing' })}
      />
    );
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
      onMenu={() => go({ kind: 'landing' })}
    />
  );
}
