import type { GameEvent, InputFrame, MatchState, PlayerId, RandomRequest, Vec2 } from './types';

export interface VerificationEntry {
  requestId: number;
  purpose: RandomRequest['purpose'];
  subject: PlayerId | null;
  valueHex: string;
  source: string;
  proof: string | null;
  latencyMs: number;
  applied: boolean;
  attempts: number;
}

export type InputSampler = () => Omit<InputFrame, 'seq'>;
export type SessionListener = (events: GameEvent[], s: MatchState) => void;

/** On-chain details for online matches (shown in the match-details panel). */
export interface OnlineMatchInfo {
  network: string;
  programId: string;
  matchPda: string;
  erUrl: string;
  validator: string | null;
  settlement: 'live' | 'settling' | 'settled' | 'error';
  resultPda: string | null;
  commitSig: string | null;
  recordSig: string | null;
  error: string | null;
}

/** What the renderer and UI need from a match session, offline or online. */
export interface SessionLike {
  readonly id: number;
  readonly state: MatchState;
  readonly localId: PlayerId;
  readonly provider: { readonly label: string; readonly verifiable: boolean };
  readonly verification: VerificationEntry[];
  readonly online: OnlineMatchInfo | null;
  /** The tutorial's practice round: two players, but not a final, so the camera follows you as in open play. */
  readonly practice?: boolean;
  /** Interpolation factor between ticks (0..1). */
  readonly alpha: number;
  renderPos(id: PlayerId): Vec2;
  update(dt: number): void;
  subscribe(fn: SessionListener): () => void;
  setInputSampler(fn: InputSampler | null): void;
  dispose(): void;
}
