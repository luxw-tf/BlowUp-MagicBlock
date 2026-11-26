/**
 * Verifies a wallet link proof (see src/chain/wallet-link.ts) with Node's
 * built-in Ed25519. A Solana wallet address is its raw Ed25519 public key.
 */
import { PublicKey } from '@solana/web3.js';
import { createPublicKey, verify } from 'node:crypto';
import { LINK_MAX_AGE_SEC, linkMessage, parseLinkMessage, type WalletProof } from '../src/chain/wallet-link';

/** DER SubjectPublicKeyInfo header for a raw 32-byte Ed25519 key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** Tolerated clock skew for a link message issued "in the future". */
const MAX_FUTURE_SKEW_SEC = 5 * 60;

export type LinkCheck = { ok: true; wallet: PublicKey } | { ok: false; reason: string };

export function verifyWalletProof(proof: WalletProof, identity: string, nowSec = Math.floor(Date.now() / 1000)): LinkCheck {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(proof.wallet);
  } catch {
    return { ok: false, reason: 'not a wallet address' };
  }
  const fields = parseLinkMessage(proof.message);
  if (!fields) return { ok: false, reason: 'malformed link message' };
  if (fields.wallet !== proof.wallet) return { ok: false, reason: 'message is for a different wallet' };
  if (fields.identity !== identity) return { ok: false, reason: 'message is for a different player' };
  // Only the exact text we would have asked for is accepted.
  if (proof.message !== linkMessage(fields.wallet, fields.identity, fields.issuedAtSec)) {
    return { ok: false, reason: 'unexpected link message text' };
  }
  if (fields.issuedAtSec > nowSec + MAX_FUTURE_SKEW_SEC) return { ok: false, reason: 'link message from the future' };
  if (nowSec - fields.issuedAtSec > LINK_MAX_AGE_SEC) return { ok: false, reason: 'link message expired; connect the wallet again' };

  let signature: Buffer;
  try {
    signature = Buffer.from(proof.signature, 'base64');
  } catch {
    return { ok: false, reason: 'bad signature encoding' };
  }
  if (signature.length !== 64) return { ok: false, reason: 'bad signature length' };
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, wallet.toBuffer()]), format: 'der', type: 'spki' });
  const valid = verify(null, Buffer.from(proof.message, 'utf8'), key, signature);
  return valid ? { ok: true, wallet } : { ok: false, reason: 'signature does not match the wallet' };
}
