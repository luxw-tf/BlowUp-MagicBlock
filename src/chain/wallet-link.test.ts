import { PublicKey } from '@solana/web3.js';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWalletProof } from '../../server/wallet-verify';
import { linkMessage, parseLinkMessage } from './wallet-link';

/** A throwaway Ed25519 "wallet": its address is the raw public key. */
function makeWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const address = new PublicKey(raw).toBase58();
  return { address, signMessage: (msg: string) => sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('base64') };
}

const identity = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const now = 1_800_000_000;

describe('wallet link proof', () => {
  it('round-trips the message fields', () => {
    const w = makeWallet();
    expect(parseLinkMessage(linkMessage(w.address, identity, now))).toEqual({ wallet: w.address, identity, issuedAtSec: now });
  });

  it('accepts a fresh, correctly signed message for this player', () => {
    const w = makeWallet();
    const message = linkMessage(w.address, identity, now);
    const r = verifyWalletProof({ wallet: w.address, message, signature: w.signMessage(message) }, identity, now + 10);
    expect(r.ok).toBe(true);
  });

  it('rejects a signature from a different wallet', () => {
    const w = makeWallet();
    const other = makeWallet();
    const message = linkMessage(w.address, identity, now);
    const r = verifyWalletProof({ wallet: w.address, message, signature: other.signMessage(message) }, identity, now);
    expect(r).toEqual({ ok: false, reason: 'signature does not match the wallet' });
  });

  it('rejects a proof made for another player identity', () => {
    const w = makeWallet();
    const message = linkMessage(w.address, identity, now);
    const someoneElse = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
    const r = verifyWalletProof({ wallet: w.address, message, signature: w.signMessage(message) }, someoneElse, now);
    expect(r).toEqual({ ok: false, reason: 'message is for a different player' });
  });

  it('rejects expired and edited messages', () => {
    const w = makeWallet();
    const message = linkMessage(w.address, identity, now);
    const sig = w.signMessage(message);
    expect(verifyWalletProof({ wallet: w.address, message, signature: sig }, identity, now + 2 * 24 * 3600).ok).toBe(false);
    const edited = message.replace('costs nothing', 'costs nothing!');
    expect(verifyWalletProof({ wallet: w.address, message: edited, signature: w.signMessage(edited) }, identity, now)).toEqual({
      ok: false,
      reason: 'unexpected link message text',
    });
  });
});
