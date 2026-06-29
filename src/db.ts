import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decrypt, encrypt, type Keyring } from './crypto.js';
import type { AccountStatus, CardConfig, Credentials } from './connectors/types.js';

// SQLite store (built-in node:sqlite — no native deps). Holds card definitions with
// the barcode AND pin encrypted at rest, plus the latest reading per card.

export type Db = DatabaseSync;

export function openDb(path = process.env.LIBCARD_DB || 'data/library.sqlite'): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id         TEXT PRIMARY KEY,
      member     TEXT NOT NULL,
      system     TEXT NOT NULL,
      base_url   TEXT NOT NULL,
      card_limit INTEGER NOT NULL DEFAULT 50,
      card_enc   TEXT NOT NULL,
      pin_enc    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS readings (
      card_id       TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      ok            INTEGER NOT NULL,
      physical      INTEGER,
      digital       INTEGER,
      holds_library INTEGER,
      holds_digital INTEGER,
      fines_due     REAL,
      remaining     INTEGER,
      error         TEXT,
      fetched_at    TEXT NOT NULL
    );
  `);
}

/** Insert or update a card; barcode + pin are encrypted before storage. */
export function upsertCard(db: Db, kr: Keyring, card: CardConfig, creds: Credentials): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO cards (id, member, system, base_url, card_limit, card_enc, pin_enc, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      member=excluded.member, system=excluded.system, base_url=excluded.base_url,
      card_limit=excluded.card_limit, card_enc=excluded.card_enc, pin_enc=excluded.pin_enc,
      updated_at=excluded.updated_at
  `).run(
    card.id, card.member, card.system, card.baseUrl, card.limit,
    encrypt(creds.card, kr), encrypt(creds.pin, kr), now, now,
  );
}

/** List card definitions — never returns secrets. */
export function listCards(db: Db): CardConfig[] {
  const rows = db.prepare(
    'SELECT id, member, system, base_url AS baseUrl, card_limit AS "limit" FROM cards ORDER BY member, system',
  ).all() as unknown as CardConfig[];
  return rows;
}

/** Decrypt and return credentials for one card. Caller uses them in memory only. */
export function getCredentials(db: Db, kr: Keyring, id: string): Credentials {
  const row = db.prepare('SELECT card_enc, pin_enc FROM cards WHERE id = ?').get(id) as
    | { card_enc: string; pin_enc: string }
    | undefined;
  if (!row) throw new Error(`no card with id "${id}"`);
  return { card: decrypt(row.card_enc, kr), pin: decrypt(row.pin_enc, kr) };
}

export function removeCard(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM cards WHERE id = ?').run(id).changes > 0;
}

export function saveReading(db: Db, s: AccountStatus): void {
  db.prepare(`
    INSERT INTO readings (card_id, ok, physical, digital, holds_library, holds_digital, fines_due, remaining, error, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      ok=excluded.ok, physical=excluded.physical, digital=excluded.digital,
      holds_library=excluded.holds_library, holds_digital=excluded.holds_digital,
      fines_due=excluded.fines_due, remaining=excluded.remaining, error=excluded.error,
      fetched_at=excluded.fetched_at
  `).run(
    s.cardId, s.ok ? 1 : 0, s.physical, s.digital, s.holdsLibrary, s.holdsDigital,
    s.finesDue, s.remaining, s.error ?? null, s.fetchedAt,
  );
}
