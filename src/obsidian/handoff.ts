/**
 * Mac-to-phone sign-in that never puts a readable token in data.json. A signed-out phone or iPad keeps a NaCl box
 * secret key in its own SecretStorage and publishes only the public key in data.json (HandoffRequest). "Sign in a
 * phone or iPad from this Mac" encrypts a fresh grant to that key with tweetnacl's box (X25519 + XSalsa20-Poly1305,
 * a throwaway sender key per box) and writes the box back (SealedHandoff). Obsidian Sync carries both; only the
 * device holding the secret key can open the box. No crypto is composed here: box is the whole construction.
 */
import nacl from 'tweetnacl';
import type { AuthState } from '../api/auth-types';
import type { SecretStore } from './secrets';

/** SecretStorage id for the phone's secret key while it waits for a sign-in. */
export const HANDOFF_KEY_SECRET_ID = 'claudsidian-handoff-key';

/** Published by a signed-out mobile device: who it is and the public key to encrypt to (base64). */
export interface HandoffRequest {
  device: string;
  publicKey: string;
  at: number;
}

/** A grant boxed to one device's request (all base64). */
export interface SealedHandoff {
  device: string;
  senderKey: string;
  nonce: string;
  box: string;
  at: number;
}

interface StoredKey {
  device: string;
  secretKey: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readStoredKey(secrets: SecretStore): StoredKey | null {
  const raw = secrets.getSecret(HANDOFF_KEY_SECRET_ID);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredKey>;
    return typeof v.device === 'string' && typeof v.secretKey === 'string' ? (v as StoredKey) : null;
  } catch {
    return null;
  }
}

/** The request this device should publish: reuses the key in SecretStorage, or makes and stores a new one. */
export function ensureHandoffRequest(secrets: SecretStore, now = Date.now()): HandoffRequest {
  const stored = readStoredKey(secrets);
  if (stored) {
    const pair = nacl.box.keyPair.fromSecretKey(unb64(stored.secretKey));
    return { device: stored.device, publicKey: b64(pair.publicKey), at: now };
  }
  const pair = nacl.box.keyPair();
  const device = b64(nacl.randomBytes(12)).replace(/[^A-Za-z0-9]/g, '');
  secrets.setSecret(HANDOFF_KEY_SECRET_ID, JSON.stringify({ device, secretKey: b64(pair.secretKey) } satisfies StoredKey));
  return { device, publicKey: b64(pair.publicKey), at: now };
}

/** This device's id while it waits for a sign-in, or null. */
export function handoffDeviceId(secrets: SecretStore): string | null {
  return readStoredKey(secrets)?.device ?? null;
}

/** True when the box was made for the key in this device's SecretStorage. */
export function isForThisDevice(secrets: SecretStore, sealed: SealedHandoff): boolean {
  return readStoredKey(secrets)?.device === sealed.device;
}

/** Mac side: box a grant to the requesting device's public key. */
export function sealHandoff(request: HandoffRequest, auth: AuthState, now = Date.now()): SealedHandoff {
  const sender = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  // copied into this realm's Uint8Array: tweetnacl checks instanceof, and a TextEncoder from another realm fails it
  const message = new Uint8Array(enc.encode(JSON.stringify({ device: request.device, auth })));
  const box = nacl.box(message, nonce, unb64(request.publicKey), sender.secretKey);
  return { device: request.device, senderKey: b64(sender.publicKey), nonce: b64(nonce), box: b64(box), at: now };
}

/** Phone side: open a box made for this device. Throws when it is not, or when it was tampered with. */
export function openHandoff(secrets: SecretStore, sealed: SealedHandoff): AuthState {
  const stored = readStoredKey(secrets);
  if (!stored || stored.device !== sealed.device) throw new Error('This sign-in was made for another device.');
  const plain = nacl.box.open(unb64(sealed.box), unb64(sealed.nonce), unb64(sealed.senderKey), unb64(stored.secretKey));
  if (!plain) throw new Error('The sign-in from the Mac could not be opened.');
  const { device, auth } = JSON.parse(dec.decode(plain)) as { device?: string; auth?: AuthState };
  if (device !== stored.device || !auth || typeof auth.accessToken !== 'string' || !auth.accessToken) {
    throw new Error('The sign-in from the Mac was not for this device.');
  }
  return auth;
}

/** Drop the waiting key once the device is signed in. */
export function forgetHandoffKey(secrets: SecretStore): void {
  if (typeof secrets.deleteSecret === 'function') secrets.deleteSecret(HANDOFF_KEY_SECRET_ID);
  else secrets.setSecret(HANDOFF_KEY_SECRET_ID, '');
}
