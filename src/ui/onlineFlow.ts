import { guestKeys, OnlineSession, type LobbyMatchInfo } from '../chain/online-session';
import type { Profile } from '../state/settings';
import type { WalletProof } from '../chain/wallet-link';
import type { MapSelection } from '../game/arena';

/** Lobby service base URL: same origin in dev (Vite proxies /api). */
export const LOBBY_URL: string = (import.meta.env.VITE_LOBBY_URL as string | undefined) ?? '';

export type GuestKeys = ReturnType<typeof guestKeys>;

export async function api<T = Record<string, unknown>>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${LOBBY_URL}${path}`, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error('Lobby service unreachable. Is `npm run server` running?');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `lobby error ${res.status}`);
  return body;
}

export const joinPayload = (profile: Profile, keys: GuestKeys, walletProof?: WalletProof | null, map?: MapSelection) => ({
  name: profile.name,
  character: profile.character,
  identity: keys.identity.publicKey.toBase58(),
  session: keys.session.publicKey.toBase58(),
  sessionExpiry: keys.sessionExpiry,
  weather: map?.weather,
  mood: map?.mood,
  ...(walletProof ? { walletProof } : {}),
});

/** Setup steps shown while a match is being created on-chain. */
export const SETUP_STEPS: { status: string; label: string }[] = [
  { status: 'creating', label: 'reserving an arena' },
  { status: 'delegating', label: 'opening the rollup' },
  { status: 'starting', label: 'drawing the first bomb holder' },
];

/** Poll a match until it is live on the rollup, then open an OnlineSession. */
export async function waitForMatch(
  matchId: string,
  keys: GuestKeys,
  cancelled: () => boolean,
  onStatus: (status: string) => void,
): Promise<OnlineSession | null> {
  const deadline = Date.now() + 5 * 60_000;
  while (!cancelled() && Date.now() < deadline) {
    const m = await api<LobbyMatchInfo>(`/api/matches/${matchId}`);
    if (cancelled()) return null;
    onStatus(m.status);
    if (m.status === 'error') throw new Error(m.error ?? 'match setup failed');
    if (m.status === 'finished' || m.status === 'settling') throw new Error('That match has already ended.');
    if (m.status === 'live' && m.erUrl) {
      return new OnlineSession(m, keys.identity, keys.session, LOBBY_URL);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!cancelled()) throw new Error('Match setup timed out. Return to the menu and try again.');
  return null;
}

/** Rejoin a live match after a reload: same identity, fresh session key. */
export async function rejoinMatch(matchId: string): Promise<OnlineSession> {
  const m = await api<LobbyMatchInfo>(`/api/matches/${matchId}`);
  if (m.status !== 'live' || !m.erUrl) throw new Error('That match is no longer live.');
  const keys = guestKeys();
  return new OnlineSession(m, keys.identity, keys.session, LOBBY_URL, true);
}
