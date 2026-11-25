import type { RandomRequest } from './types';

export interface RandomFulfillment {
  requestId: number;
  bytes: Uint8Array;
  source: string;
  /** Transaction signature / proof reference once backed by MagicBlock VRF. */
  proof: string | null;
  latencyMs: number;
}

/**
 * Source of decisive randomness. The simulation never generates randomness
 * itself; it issues requests and waits (visibly) for a fulfilment.
 *
 * The production implementation is MagicBlock VRF with callbacks on the ER.
 * Until that integration exists (PRD Phase 00), the local provider below is
 * used and is labelled as unverified everywhere it is surfaced — it is never
 * presented as verifiable.
 */
export interface RandomnessProvider {
  readonly label: string;
  readonly verifiable: boolean;
  request(req: RandomRequest): Promise<RandomFulfillment>;
}

export class LocalDevRandomness implements RandomnessProvider {
  readonly label = 'Local dev randomness (unverified)';
  readonly verifiable = false;

  constructor(private readonly simulatedLatencyMs = 40) {}

  request(req: RandomRequest): Promise<RandomFulfillment> {
    const started = performance.now();
    return new Promise((resolve) => {
      setTimeout(() => {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        resolve({
          requestId: req.id,
          bytes,
          source: 'local-crypto',
          proof: null,
          latencyMs: performance.now() - started,
        });
      }, this.simulatedLatencyMs);
    });
  }
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
