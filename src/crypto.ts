import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Reversible at-rest encryption for card credentials. PINs must be replayed to the
// library, so this is AES-256-GCM (authenticated), NOT hashing. The master key lives
// outside the DB (env var, sourced from a k8s Secret) — that separation is what makes
// at-rest encryption meaningful.
//
// Blob format (string, dot-delimited):  v1.<keyId>.<b64 iv>.<b64 tag>.<b64 ciphertext>
// The keyId enables key rotation: encrypt with the primary key, but decrypt anything
// whose keyId we still hold.

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, random per encryption (never reuse with a key)

export interface Keyring {
  primaryId: string;
  keys: Map<string, Buffer>;
}

/**
 * Build a keyring from the environment.
 *  - LIBCARD_MASTER_KEY        base64 of 32 bytes (required) — the primary key
 *  - LIBCARD_MASTER_KEY_ID     id for the primary key (default "k1")
 *  - LIBCARD_RETIRED_KEY_<ID>  base64 32 bytes — old keys kept for decrypt during rotation
 */
export function loadKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  const b64 = env.LIBCARD_MASTER_KEY;
  if (!b64) throw new Error('LIBCARD_MASTER_KEY not set (base64 of 32 bytes — run: npm run cli -- gen-key)');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`LIBCARD_MASTER_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  const primaryId = env.LIBCARD_MASTER_KEY_ID || 'k1';
  const keys = new Map<string, Buffer>([[primaryId, key]]);
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^LIBCARD_RETIRED_KEY_(.+)$/);
    if (m && m[1] && v) {
      const rk = Buffer.from(v, 'base64');
      if (rk.length === KEY_BYTES) keys.set(m[1].toLowerCase(), rk);
    }
  }
  return { primaryId, keys };
}

export function generateKeyBase64(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

export function encrypt(plain: string, kr: Keyring): string {
  const key = kr.keys.get(kr.primaryId);
  if (!key) throw new Error(`no key for primary id ${kr.primaryId}`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', kr.primaryId, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(blob: string, kr: Keyring): string {
  const parts = blob.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('bad ciphertext format');
  const [, keyId, ivB, tagB, ctB] = parts as [string, string, string, string, string];
  const key = kr.keys.get(keyId);
  if (!key) throw new Error(`no key for id "${keyId}" (rotation? set LIBCARD_RETIRED_KEY_${keyId.toUpperCase()})`);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}

/** True if a blob was encrypted under a non-primary key (i.e. should be re-encrypted). */
export function needsReencrypt(blob: string, kr: Keyring): boolean {
  return blob.split('.')[1] !== kr.primaryId;
}
