import { Connection, PublicKey } from '@solana/web3.js';
import { guestKeys } from './online-session';
import { decodeProfile, DEFAULT_BASE_RPC, pda, PROGRAM_ID } from './program';
import { linkMessage, type WalletProof } from './wallet-link';

interface WalletProvider {
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } } | void>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array } | Uint8Array>;
  on?(event: 'accountChanged' | 'disconnect', listener: () => void): void;
  off?(event: 'accountChanged' | 'disconnect', listener: () => void): void;
}

export function browserWallets() {
  const browser = window as Window & {
    phantom?: { solana?: WalletProvider };
    solflare?: WalletProvider;
    backpack?: { solana?: WalletProvider };
  };
  return [
    { name: 'Phantom', provider: browser.phantom?.solana },
    { name: 'Solflare', provider: browser.solflare },
    { name: 'Backpack', provider: browser.backpack?.solana },
  ].flatMap(({ name, provider }) => provider ? [{ name, provider }] : []);
}

export async function signWalletLink(provider: WalletProvider): Promise<WalletProof> {
  const connection = await provider.connect();
  const publicKey = connection?.publicKey ?? provider.publicKey;
  if (!publicKey) throw new Error('Wallet did not return a public key.');
  const wallet = publicKey.toBase58();
  const identity = guestKeys().identity.publicKey.toBase58();
  const message = linkMessage(wallet, identity, Math.floor(Date.now() / 1000));
  const signed = await provider.signMessage(new TextEncoder().encode(message));
  const signature = 'signature' in signed ? signed.signature : signed;
  if (signature.length !== 64 || (provider.publicKey && provider.publicKey.toBase58() !== wallet)) {
    throw new Error('The wallet account changed or returned an invalid signature.');
  }
  return { wallet, message, signature: btoa(String.fromCharCode(...signature)) };
}

export function watchWallet(provider: WalletProvider, clear: () => void) {
  provider.on?.('accountChanged', clear);
  provider.on?.('disconnect', clear);
  return () => {
    provider.off?.('accountChanged', clear);
    provider.off?.('disconnect', clear);
  };
}

export async function readWalletProfile(address: string) {
  const wallet = new PublicKey(address);
  const connection = new Connection(DEFAULT_BASE_RPC, 'confirmed');
  const info = await connection.getAccountInfo(pda.profile(wallet));
  if (!info) return null;
  if (!info.owner.equals(PROGRAM_ID)) throw new Error('Invalid profile owner.');
  return decodeProfile(info.data);
}
