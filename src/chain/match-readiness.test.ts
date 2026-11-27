import { BN, BorshAccountsCoder } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, type AccountInfo } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { waitForMatchAccounts } from '../../server/match-readiness';
import { IDL, instructions, pda, PHASE, PROGRAM_ID, sendTx } from './program';

async function roomFixture() {
  const match = pda.match(41n);
  const seats = [0, 1, 3].map((index) => ({
    index, identity: Keypair.generate().publicKey, session: Keypair.generate().publicKey,
  }));
  const coder = new BorshAccountsCoder(IDL);
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const put = async (key: PublicKey, name: string, fields: Record<string, unknown>) => {
    accounts.set(key.toBase58(), { owner: PROGRAM_ID, data: await coder.encode(name, fields), lamports: 1, executable: false });
  };
  const zero = new BN(0);
  const players = Array<PublicKey>(6).fill(PublicKey.default);
  for (const seat of seats) {
    players[seat.index] = seat.identity;
    await put(pda.player(match, seat.index), 'PlayerState', {
      match_key: match, index: seat.index, authority: seat.identity, session_key: seat.session,
      session_expiry: zero, x: 0, z: 0, seq: 0, last_input_slot: zero, inputs_accepted: 0, bump: 0,
    });
  }
  await put(match, 'MatchState', {
    authority: seats[0].identity, match_id: new BN(41), phase: PHASE.LOBBY, player_count: 3, alive_mask: 0b001011,
    holder: 255, round: 0, slot_ms: 10, round_start_slot: zero, round_deadline_slot: zero,
    fuse_deadline_slot: zero, fuse_ms: 0, protected_player: 255, protected_until_slot: zero, vrf_nonce: 0,
    vrf_purpose: 0, vrf_requested_slot: zero, vrf_fulfilled: 0, last_randomness: Array(32).fill(0),
    transfers: 0, last_giver: 255, placements: Array(6).fill(0), winner: 255, players, bump: 0,
    wallets: Array(6).fill(PublicKey.default), passes: Array(6).fill(0), received: Array(6).fill(0),
  });
  return { match, seats, accounts };
}

describe('online match account readiness', () => {
  it('loads only the occupied PDAs in a three-player room', async () => {
    const { match, seats, accounts } = await roomFixture();
    const read = vi.fn(async (key: PublicKey) => accounts.get(key.toBase58()) ?? null);
    await waitForMatchAccounts(read, match, seats, 'MagicBlock rollup', 0);
    expect(read.mock.calls.map(([key]) => key.toBase58())).toEqual(
      [match, ...seats.map(({ index }) => pda.player(match, index))].map((key) => key.toBase58()),
    );
  });

  it('retries a transient read and waits for the correct account owner', async () => {
    const { match, seats, accounts } = await roomFixture();
    const slowSeat = pda.player(match, 3);
    let reads = 0;
    const read = async (key: PublicKey) => {
      const account = accounts.get(key.toBase58())!;
      if (key.equals(slowSeat)) {
        if (++reads === 1) throw new Error('RPC temporarily unavailable');
        if (reads === 2) return { ...account, owner: PublicKey.default };
      }
      return account;
    };
    vi.useFakeTimers();
    try {
      const ready = waitForMatchAccounts(read, match, seats, 'MagicBlock rollup', 5_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await ready;
      expect(reads).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the layer, missing seat and mismatched seat when readiness fails', async () => {
    const { match, seats, accounts } = await roomFixture();
    accounts.set(pda.player(match, 1).toBase58(), accounts.get(pda.player(match, 0).toBase58())!);
    accounts.delete(pda.player(match, 3).toBase58());
    const read = async (key: PublicKey) => accounts.get(key.toBase58()) ?? null;
    await expect(waitForMatchAccounts(read, match, seats, 'MagicBlock rollup', 0))
      .rejects.toThrow('seat 1 has mismatched player data; seat 3 missing');
  });

  it('supplies only occupied PlayerState accounts to Finalize', async () => {
    const { match, seats } = await roomFixture();
    const ix = instructions(new Connection('http://localhost:8899'));
    const finalize = await ix.finalize(seats[0].identity, match, seats.map(({ index }) => index));
    expect(finalize.keys.slice(4).map(({ pubkey, isWritable }) => [pubkey.toBase58(), isWritable])).toEqual(
      seats.map(({ index }) => [pda.player(match, index).toBase58(), true]),
    );
  });
});

it('rebroadcasts identical bytes and waits for the requested confirmation', async () => {
  const payer = Keypair.generate();
  const connection = new Connection('http://localhost:8899', 'confirmed');
  vi.spyOn(connection, 'getLatestBlockhash').mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10,
  });
  const send = vi.spyOn(connection, 'sendRawTransaction').mockResolvedValue('test-signature');
  const status = vi.spyOn(connection, 'getSignatureStatuses');
  status
    .mockResolvedValueOnce({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 0, err: null, confirmationStatus: 'processed' }] })
    .mockResolvedValueOnce({ context: { slot: 2 }, value: [null] })
    .mockResolvedValueOnce({ context: { slot: 3 }, value: [{ slot: 1, confirmations: 2, err: null, confirmationStatus: 'confirmed' }] });
  const ix = await instructions(connection).createMatch(payer.publicKey, 41n, 10);
  const result = await sendTx(connection, [ix], [], payer, { confirm: true, preflight: true, pollMs: 10, resendMs: 1 });
  expect(result.err).toBeNull();
  expect(status).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][1]?.skipPreflight).toBe(false);
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
});
