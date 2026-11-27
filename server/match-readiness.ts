import type { AccountInfo, PublicKey } from '@solana/web3.js';
import { decodeMatch, decodePlayer, pda, PHASE, PROGRAM_ID } from '../src/chain/program';

type ReadAccount = (key: PublicKey) => Promise<AccountInfo<Buffer> | null>;

/** Verify the actual occupied PDAs. Small rooms have gaps in their seat indices. */
export async function waitForMatchAccounts(
  read: ReadAccount,
  match: PublicKey,
  seats: readonly { index: number; identity: PublicKey; session: PublicKey }[],
  layer: 'Solana' | 'MagicBlock rollup',
  timeoutMs: number,
) {
  const targets = [
    { key: match, seat: null },
    ...seats.map((seat) => ({ key: pda.player(match, seat.index), seat })),
  ];
  const seatMask = seats.reduce((mask, seat) => mask | (1 << seat.index), 0);
  const deadline = Date.now() + timeoutMs;
  let pending: string[];
  do {
    const checks = await Promise.all(targets.map(async ({ key, seat }) => {
      const label = seat === null ? 'match' : `seat ${seat.index}`;
      try {
        const account = await read(key);
        if (!account) return `${label} missing`;
        if (!account.owner.equals(PROGRAM_ID)) return `${label} has unexpected owner ${account.owner.toBase58()}`;
        if (seat !== null) {
          const player = decodePlayer(account.data);
          const matches = player.index === seat.index && player.matchKey.equals(match)
            && player.authority.equals(seat.identity) && player.sessionKey.equals(seat.session);
          return matches ? null : `${label} has mismatched player data`;
        }
        const state = decodeMatch(account.data);
        if (state.phase !== PHASE.LOBBY || state.playerCount !== seats.length || state.aliveMask !== seatMask
          || !seats.every((seat) => state.players[seat.index]?.equals(seat.identity))) {
          return 'match roster is not ready';
        }
        return null;
      } catch (error) {
        return `${label}: ${(error as Error).message.slice(0, 160)}`;
      }
    }));
    pending = checks.filter((issue): issue is string => issue !== null);
    if (!pending.length) return;
    if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error(`${layer} accounts not ready for match ${match.toBase58()} (${pending.join('; ')})`);
}
