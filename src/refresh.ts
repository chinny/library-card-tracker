import { chromium, type Browser } from 'playwright';
import { fetchAccount } from './connectors/sirsidynix.js';
import type { AccountStatus, CardConfig } from './connectors/types.js';
import type { Keyring } from './crypto.js';
import { getCredentials, listCards, saveReading, type Db } from './db.js';

/** Snapshot of a refresh run, reported before each card and once at the end. */
export interface RefreshProgress {
  done: number;
  total: number;
  /** "Member · system" label of the card being fetched; null when the run is over. */
  current: string | null;
}

/** Minimal sink for per-card outcomes; the server passes its Fastify logger. */
export interface RefreshLogger {
  info: (o: object, msg: string) => void;
  warn: (o: object, msg: string) => void;
}

/** One extra attempt absorbs a slow account panel without hammering the library. */
const RETRY_DELAY_MS = 5_000;

// Shared refresh used by both the CLI and the server scheduler: launch one browser,
// read every card sequentially (gentle on the libraries), persist each reading.
export async function refreshAll(
  db: Db,
  kr: Keyring,
  onProgress?: (p: RefreshProgress) => void,
  log?: RefreshLogger,
): Promise<AccountStatus[]> {
  const cards = listCards(db);
  const out: AccountStatus[] = [];
  if (cards.length === 0) return out;

  const browser = await chromium.launch();
  try {
    for (const card of cards) {
      onProgress?.({ done: out.length, total: cards.length, current: `${card.member} · ${card.system}` });
      const started = Date.now();
      let status = await attempt(browser, db, kr, card);
      // Panel loads are racy under load; retry once before publishing a failure.
      if (!status.ok) {
        log?.warn({ card: card.id, error: status.error }, 'card fetch failed, retrying once');
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        const second = await attempt(browser, db, kr, card);
        if (second.ok) status = second;
      }
      const ms = Date.now() - started;
      if (status.ok) log?.info({ card: card.id, physical: status.physical, ms }, 'card fetch ok');
      else log?.warn({ card: card.id, error: status.error, ms }, 'card fetch failed');
      saveReading(db, status);
      out.push(status);
    }
  } finally {
    await browser.close();
  }
  onProgress?.({ done: out.length, total: cards.length, current: null });
  const failed = out.filter((s) => !s.ok).length;
  log?.info({ total: out.length, failed }, 'refresh run complete');
  return out;
}

async function attempt(
  browser: Browser,
  db: Db,
  kr: Keyring,
  card: CardConfig,
): Promise<AccountStatus> {
  try {
    const creds = getCredentials(db, kr, card.id); // in-memory only
    return await fetchAccount(browser, card, creds);
  } catch (e) {
    return {
      cardId: card.id, member: card.member, system: card.system, ok: false,
      physical: null, digital: null, holdsLibrary: null, holdsDigital: null,
      finesDue: null, limit: card.limit, remaining: null,
      fetchedAt: new Date().toISOString(), error: (e as Error).message,
    };
  }
}
