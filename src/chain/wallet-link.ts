/**
 * Wallet linking: a player proves they own a wallet by signing one plain
 * message (no transaction, no fee). The lobby verifies the signature, then
 * attaches that wallet to the player's seat so the settled result counts
 * towards the wallet's on-chain profile. Gameplay itself never touches the
 * wallet, so there are no wallet prompts during a match.
 *
 * The message binds the wallet to this guest identity and a time, so a
 * signature can't be replayed for someone else's identity or reused later.
 */
export const LINK_DOMAIN = 'BlowUp';
/** How long a signed link message stays valid. */
export const LINK_MAX_AGE_SEC = 24 * 60 * 60;

export function linkMessage(wallet: string, identity: string, issuedAtSec: number): string {
  return [
    `${LINK_DOMAIN}: link this wallet to your player`,
    '',
    'Signing proves you own this wallet so your online match results are',
    'saved to its profile on Solana. It is not a transaction and costs nothing.',
    '',
    `Wallet: ${wallet}`,
    `Player: ${identity}`,
    `Issued: ${new Date(issuedAtSec * 1000).toISOString()}`,
  ].join('\n');
}

/** Parse the fields back out (the lobby rebuilds the exact text before verifying). */
export function parseLinkMessage(message: string): { wallet: string; identity: string; issuedAtSec: number } | null {
  const get = (label: string) => new RegExp(`^${label}: (.+)$`, 'm').exec(message)?.[1]?.trim();
  const wallet = get('Wallet');
  const identity = get('Player');
  const issued = get('Issued');
  if (!wallet || !identity || !issued) return null;
  const ms = Date.parse(issued);
  if (!Number.isFinite(ms)) return null;
  return { wallet, identity, issuedAtSec: Math.floor(ms / 1000) };
}

export interface WalletProof {
  wallet: string; // base58 public key
  message: string;
  signature: string; // base64
}
