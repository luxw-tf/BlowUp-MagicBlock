/**
 * Shared client for the `blowup` program. Used by the browser (OnlineSession)
 * and by the lobby service (server/). No React, no Node-only APIs.
 */
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from '@solana/web3.js';
import idlJson from './blowup.idl.json';

export const IDL = idlJson as anchor.Idl;
export const PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);
/** MagicBlock VRF queue inside the Ephemeral Rollup (fee-exempt). */
export const EPHEMERAL_QUEUE = new PublicKey('5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc');
export const DEFAULT_BASE_RPC = 'https://rpc.magicblock.app/devnet';
export const DEFAULT_ROUTER = 'https://devnet-router.magicblock.app';
export const NO_PLAYER = 255;
export const MAX_PLAYERS = 6;

export const PHASE = { LOBBY: 0, ASSIGNING: 1, ACTIVE: 2, FINISHED: 3 } as const;

/** Positions are millimetres on-chain, units in the client sim. */
export const mmToUnits = (mm: number) => mm / 1000;
export const unitsToMm = (u: number) => Math.round(u * 1000);

// ───────────────────────── PDAs ─────────────────────────

const le64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

export const pda = {
  match: (matchId: bigint) => PublicKey.findProgramAddressSync([new TextEncoder().encode('match'), le64(matchId)], PROGRAM_ID)[0],
  player: (match: PublicKey, index: number) =>
    PublicKey.findProgramAddressSync([new TextEncoder().encode('player'), match.toBytes(), Uint8Array.of(index)], PROGRAM_ID)[0],
  result: (match: PublicKey) => PublicKey.findProgramAddressSync([new TextEncoder().encode('result'), match.toBytes()], PROGRAM_ID)[0],
  /** A wallet's lifetime record across online matches. */
  profile: (wallet: PublicKey) => PublicKey.findProgramAddressSync([new TextEncoder().encode('profile'), wallet.toBytes()], PROGRAM_ID)[0],
};

// ───────────────────────── accounts ─────────────────────────

const coder = new anchor.BorshAccountsCoder(IDL);
const num = (v: unknown): number => (anchor.BN.isBN(v) ? (v as anchor.BN).toNumber() : Number(v));

export interface ChainMatch {
  authority: PublicKey;
  matchId: bigint;
  phase: number;
  playerCount: number;
  aliveMask: number;
  holder: number;
  round: number;
  slotMs: number;
  roundStartSlot: number;
  roundDeadlineSlot: number;
  fuseDeadlineSlot: number;
  fuseMs: number;
  protectedPlayer: number;
  protectedUntilSlot: number;
  vrfNonce: number;
  vrfPurpose: number;
  vrfRequestedSlot: number;
  vrfFulfilled: number;
  lastRandomness: Uint8Array;
  transfers: number;
  lastGiver: number;
  placements: number[];
  winner: number;
  players: PublicKey[];
  /** Linked wallet per seat (PublicKey.default = guest). */
  wallets: PublicKey[];
  /** Passes made / bombs received per seat. */
  passes: number[];
  received: number[];
}

export interface ChainPlayer {
  matchKey: PublicKey;
  index: number;
  authority: PublicKey;
  sessionKey: PublicKey;
  sessionExpiry: number;
  x: number; // mm
  z: number; // mm
  seq: number;
  lastInputSlot: number;
  inputsAccepted: number;
}

export interface ChainResult {
  matchKey: PublicKey;
  matchId: bigint;
  winner: PublicKey;
  players: PublicKey[];
  placements: number[];
  rounds: number;
  transfers: number;
  vrfFulfilled: number;
  lastRandomness: Uint8Array;
  recordedSlot: number;
  /** Bitmask of seats whose wallet profile already counted this match. */
  progressRecorded: number;
}

export interface ChainProfile {
  wallet: PublicKey;
  matches: number;
  wins: number;
  podiums: number;
  passes: number;
  received: number;
  lastMatch: PublicKey;
  updatedSlot: number;
}

type Raw = Record<string, unknown>;

/** BorshAccountsCoder returns the IDL's snake_case field names; normalize to camelCase. */
function decodeRaw(name: string, data: Uint8Array): Raw {
  const r = coder.decode(name, data as Buffer) as Raw;
  const out: Raw = {};
  for (const [k, v] of Object.entries(r)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out;
}

export function decodeMatch(data: Uint8Array): ChainMatch {
  const r = decodeRaw('MatchState', data);
  return {
    authority: r.authority as PublicKey,
    matchId: BigInt((r.matchId as anchor.BN).toString()),
    phase: num(r.phase),
    playerCount: num(r.playerCount),
    aliveMask: num(r.aliveMask),
    holder: num(r.holder),
    round: num(r.round),
    slotMs: num(r.slotMs),
    roundStartSlot: num(r.roundStartSlot),
    roundDeadlineSlot: num(r.roundDeadlineSlot),
    fuseDeadlineSlot: num(r.fuseDeadlineSlot),
    fuseMs: num(r.fuseMs),
    protectedPlayer: num(r.protectedPlayer),
    protectedUntilSlot: num(r.protectedUntilSlot),
    vrfNonce: num(r.vrfNonce),
    vrfPurpose: num(r.vrfPurpose),
    vrfRequestedSlot: num(r.vrfRequestedSlot),
    vrfFulfilled: num(r.vrfFulfilled),
    lastRandomness: Uint8Array.from(r.lastRandomness as number[]),
    transfers: num(r.transfers),
    lastGiver: num(r.lastGiver),
    placements: (r.placements as number[]).map(num),
    winner: num(r.winner),
    players: r.players as PublicKey[],
    wallets: r.wallets as PublicKey[],
    passes: (r.passes as number[]).map(num),
    received: (r.received as number[]).map(num),
  };
}

export function decodePlayer(data: Uint8Array): ChainPlayer {
  const r = decodeRaw('PlayerState', data);
  return {
    matchKey: r.matchKey as PublicKey,
    index: num(r.index),
    authority: r.authority as PublicKey,
    sessionKey: r.sessionKey as PublicKey,
    sessionExpiry: num(r.sessionExpiry),
    x: num(r.x),
    z: num(r.z),
    seq: num(r.seq),
    lastInputSlot: num(r.lastInputSlot),
    inputsAccepted: num(r.inputsAccepted),
  };
}

export function decodeResult(data: Uint8Array): ChainResult {
  const r = decodeRaw('MatchResult', data);
  return {
    matchKey: r.matchKey as PublicKey,
    matchId: BigInt((r.matchId as anchor.BN).toString()),
    winner: r.winner as PublicKey,
    players: r.players as PublicKey[],
    placements: (r.placements as number[]).map(num),
    rounds: num(r.rounds),
    transfers: num(r.transfers),
    vrfFulfilled: num(r.vrfFulfilled),
    lastRandomness: Uint8Array.from(r.lastRandomness as number[]),
    recordedSlot: num(r.recordedSlot),
    progressRecorded: num(r.progressRecorded),
  };
}

export function decodeProfile(data: Uint8Array): ChainProfile {
  const r = decodeRaw('PlayerProfile', data);
  return {
    wallet: r.wallet as PublicKey,
    matches: num(r.matches),
    wins: num(r.wins),
    podiums: num(r.podiums),
    passes: num(r.passes),
    received: num(r.received),
    lastMatch: r.lastMatch as PublicKey,
    updatedSlot: num(r.updatedSlot),
  };
}

export const ERROR_NAMES = new Map<number, string>(
  ((idlJson as { errors?: { code: number; name: string }[] }).errors ?? []).map((e) => [e.code, e.name]),
);

export function explainError(err: unknown): string | null {
  if (!err) return null;
  const ie = (err as { InstructionError?: [number, unknown] }).InstructionError;
  const custom = ie && (ie[1] as { Custom?: number }).Custom;
  if (typeof custom === 'number') return ERROR_NAMES.get(custom) ?? `Custom(${custom})`;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

// ───────────────────────── instructions ─────────────────────────

/** Instruction builder bound to a connection; never signs or sends. */
export function instructions(connection: Connection) {
  const dummy = Keypair.generate();
  const wallet = {
    publicKey: dummy.publicKey,
    signTransaction: async <T,>(t: T) => t,
    signAllTransactions: async <T,>(t: T[]) => t,
  };
  const program = new anchor.Program(IDL, new anchor.AnchorProvider(connection, wallet as anchor.Wallet, {}));
  const m = program.methods;
  const seed = () => Array.from(crypto.getRandomValues(new Uint8Array(8)));
  const bn = (n: bigint | number) => new anchor.BN(n.toString());
  const validatorMeta = (v?: PublicKey) => (v ? [{ pubkey: v, isSigner: false, isWritable: false }] : []);

  return {
    createMatch: (authority: PublicKey, matchId: bigint, slotMs: number) =>
      m.createMatch(bn(matchId), slotMs).accountsPartial({ authority, matchState: pda.match(matchId) }).instruction(),
    /** `wallet`: the seat's verified linked wallet, or PublicKey.default for a guest. */
    joinMatch: (
      authority: PublicKey,
      match: PublicKey,
      index: number,
      player: PublicKey,
      session: PublicKey,
      expiry: number,
      wallet: PublicKey = PublicKey.default,
    ) =>
      m
        .joinMatch(index, player, session, bn(expiry), wallet)
        .accountsPartial({ authority, matchState: match, playerState: pda.player(match, index) })
        .instruction(),
    delegatePlayer: (payer: PublicKey, match: PublicKey, index: number, validator?: PublicKey) =>
      m
        .delegatePlayer(index)
        .accountsPartial({ payer, matchState: match, playerState: pda.player(match, index) })
        .remainingAccounts(validatorMeta(validator))
        .instruction(),
    delegateMatch: (payer: PublicKey, matchId: bigint, validator?: PublicKey) =>
      m
        .delegateMatch(bn(matchId))
        .accountsPartial({ payer, matchState: pda.match(matchId) })
        .remainingAccounts(validatorMeta(validator))
        .instruction(),
    startMatch: (payer: PublicKey, match: PublicKey) =>
      m.startMatch(seed()).accountsPartial({ payer, matchState: match, oracleQueue: EPHEMERAL_QUEUE }).instruction(),
    eliminate: (payer: PublicKey, match: PublicKey) =>
      m.eliminate(seed()).accountsPartial({ payer, matchState: match, oracleQueue: EPHEMERAL_QUEUE }).instruction(),
    retryRandomness: (payer: PublicKey, match: PublicKey) =>
      m.retryRandomness(seed()).accountsPartial({ payer, matchState: match, oracleQueue: EPHEMERAL_QUEUE }).instruction(),
    abortMatch: (payer: PublicKey, match: PublicKey) => m.abortMatch().accountsPartial({ payer, matchState: match }).instruction(),
    submitInput: (signer: PublicKey, match: PublicKey, index: number, seq: number, xMm: number, zMm: number) =>
      m.submitInput(seq, xMm, zMm).accountsPartial({ signer, matchState: match, playerState: pda.player(match, index) }).instruction(),
    renewSession: (authority: PublicKey, match: PublicKey, index: number, session: PublicKey, expiry: number) =>
      m
        .renewSession(session, bn(expiry))
        .accountsPartial({ authority, playerState: pda.player(match, index) })
        .instruction(),
    /** method 0 = tag, 1 = throw hit. */
    transfer: (session: PublicKey, match: PublicKey, from: number, to: number, method: 0 | 1) =>
      m
        .transfer(to, method, seed())
        .accountsPartial({
          payer: session,
          matchState: match,
          holderState: pda.player(match, from),
          targetState: pda.player(match, to),
          oracleQueue: EPHEMERAL_QUEUE,
        })
        .instruction(),
    /** `seats`: the player indices that exist in this match. */
    finalize: (payer: PublicKey, match: PublicKey, seats: number[]) =>
      m
        .finalize()
        .accountsPartial({ payer, matchState: match })
        .remainingAccounts(seats.map((i) => ({ pubkey: pda.player(match, i), isSigner: false, isWritable: true })))
        .instruction(),
    /** Lobby hands a silent player to a bot key (program enforces the grace period). */
    takeover: (authority: PublicKey, match: PublicKey, index: number, botSession: PublicKey) =>
      m
        .takeover(botSession)
        .accountsPartial({ authority, matchState: match, playerState: pda.player(match, index) })
        .instruction(),
    recordResult: (payer: PublicKey, match: PublicKey) =>
      m.recordResult().accountsPartial({ payer, matchState: match, result: pda.result(match) }).instruction(),
    /** Add a settled match to the wallet profile linked to `seat` (base layer; once per seat). */
    recordProgress: (payer: PublicKey, match: PublicKey, seat: number, wallet: PublicKey) =>
      m
        .recordProgress(seat)
        .accountsPartial({ payer, matchState: match, result: pda.result(match), wallet, profile: pda.profile(wallet) })
        .instruction(),
  };
}

export type Instructions = ReturnType<typeof instructions>;

// ───────────────────────── sending ─────────────────────────

export interface SendResult {
  sig: string;
  ms: number;
  err: string | null;
}

const blockhashCache = new WeakMap<Connection, { hash: string; at: number }>();

export async function recentBlockhash(conn: Connection, maxAgeMs = 2_000): Promise<string> {
  const c = blockhashCache.get(conn);
  if (c && performance.now() - c.at < maxAgeMs) return c.hash;
  const { blockhash } = await conn.getLatestBlockhash();
  blockhashCache.set(conn, { hash: blockhash, at: performance.now() });
  return blockhash;
}

/**
 * Sign and send. With `confirm`, polls the signature status (ER preflight
 * doesn't simulate, so the status error is the only truth).
 */
export async function sendTx(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  feePayer: Keypair,
  opts: { confirm?: boolean; timeoutMs?: number; pollMs?: number; commitment?: Commitment; preflight?: boolean; resendMs?: number } = {},
): Promise<SendResult> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer.publicKey;
  tx.recentBlockhash = await recentBlockhash(conn);
  tx.sign(feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey)));
  const wire = tx.serialize();
  const commitment = opts.commitment ?? conn.commitment ?? 'processed';
  const t0 = performance.now();
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(wire, { skipPreflight: !opts.preflight, preflightCommitment: commitment });
  } catch (e) {
    return { sig: '', ms: performance.now() - t0, err: `send failed: ${(e as Error).message.slice(0, 160)}` };
  }
  if (!opts.confirm) return { sig, ms: performance.now() - t0, err: null };
  const timeout = opts.timeoutMs ?? 15_000;
  const poll = opts.pollMs ?? 25;
  let resendAt = t0 + (opts.resendMs ?? Infinity);
  while (performance.now() - t0 < timeout) {
    try {
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st?.err) return { sig, ms: performance.now() - t0, err: explainError(st.err) };
      const status = st?.confirmationStatus;
      if (status === 'finalized' || (status === 'confirmed' && commitment !== 'finalized') || (status === 'processed' && commitment === 'processed')) {
        return { sig, ms: performance.now() - t0, err: null };
      }
      if (!st && opts.resendMs && performance.now() >= resendAt) {
        resendAt = performance.now() + opts.resendMs;
        // Resending the same signed bytes retains the signature and cannot repeat the write.
        await conn.sendRawTransaction(wire, { skipPreflight: true, maxRetries: 0 });
      }
    } catch {
      // transient RPC error / rate limit
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  return { sig, ms: performance.now() - t0, err: 'timeout' };
}

// ───────────────────────── account watching ─────────────────────────

/**
 * Websocket subscription plus a slow polling fallback, de-duplicated.
 *
 * Websocket subscriptions are established asynchronously, so an update that
 * lands right after subscribing can be missed (seen on devnet: a match
 * deadlocked after missing its ASSIGNING→ACTIVE change). Polling also covers
 * socket drops. Returns an unsubscribe function.
 */
export function watchAccount(
  conn: Connection,
  key: PublicKey,
  onData: (data: Uint8Array, slot: number) => void,
  opts: { pollMs?: number } = {},
): () => void {
  let last: Uint8Array | null = null;
  let lastSlot = 0;
  let stopped = false;
  const deliver = (data: Uint8Array, slot: number) => {
    if (stopped || slot < lastSlot) return;
    if (last && last.length === data.length && last.every((b, i) => b === data[i])) {
      lastSlot = Math.max(lastSlot, slot);
      return;
    }
    last = Uint8Array.from(data);
    lastSlot = slot;
    onData(data, slot);
  };
  const subId = conn.onAccountChange(key, (info, ctx) => deliver(info.data, ctx.slot), { commitment: 'processed' });
  const poll = async () => {
    try {
      const r = await conn.getAccountInfoAndContext(key, 'processed');
      if (r.value) deliver(r.value.data, r.context.slot);
    } catch {
      // transient; next poll retries
    }
  };
  void poll();
  const timer = setInterval(poll, opts.pollMs ?? 750);
  return () => {
    stopped = true;
    clearInterval(timer);
    void conn.removeAccountChangeListener(subId).catch(() => {});
  };
}

// ───────────────────────── ER slot clock ─────────────────────────

/**
 * Estimates the ER's current slot from periodic getSlot samples, so fuse
 * deadlines (in slots) can be shown as seconds without a request per frame.
 */
export class SlotClock {
  private baseSlot = 0;
  private baseAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly conn: Connection,
    public slotMs: number,
  ) {}

  async sync() {
    const t0 = performance.now();
    const slot = await this.conn.getSlot('processed');
    const t1 = performance.now();
    this.baseSlot = slot;
    this.baseAt = (t0 + t1) / 2;
  }

  start(everyMs = 2_000) {
    void this.sync().catch(() => {});
    this.timer = setInterval(() => void this.sync().catch(() => {}), everyMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Feed a slot observed in a subscription context (only moves forward). */
  observe(slot: number) {
    if (slot > this.now()) {
      this.baseSlot = slot;
      this.baseAt = performance.now();
    }
  }

  now(): number {
    if (!this.baseAt) return 0;
    return this.baseSlot + (performance.now() - this.baseAt) / this.slotMs;
  }

  /** Seconds until `slot` (negative if past). */
  secondsUntil(slot: number): number {
    return ((slot - this.now()) * this.slotMs) / 1000;
  }
}
