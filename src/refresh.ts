import { chromium } from 'playwright';
import { fetchAccount } from './connectors/sirsidynix.js';
import type { AccountStatus } from './connectors/types.js';
import type { Keyring } from './crypto.js';
import { getCredentials, listCards, saveReading, type Db } from './db.js';

// Shared refresh used by both the CLI and the server scheduler: launch one browser,
// read every card sequentially (gentle on the libraries), persist each reading.
export async function refreshAll(db: Db, kr: Keyring): Promise<AccountStatus[]> {
  const cards = listCards(db);
  const out: AccountStatus[] = [];
  if (cards.length === 0) return out;

  const browser = await chromium.launch();
  try {
    for (const card of cards) {
      let status: AccountStatus;
      try {
        const creds = getCredentials(db, kr, card.id); // in-memory only
        status = await fetchAccount(browser, card, creds);
      } catch (e) {
        status = {
          cardId: card.id, member: card.member, system: card.system, ok: false,
          physical: null, digital: null, holdsLibrary: null, holdsDigital: null,
          finesDue: null, limit: card.limit, remaining: null,
          fetchedAt: new Date().toISOString(), error: (e as Error).message,
        };
      }
      saveReading(db, status);
      out.push(status);
    }
  } finally {
    await browser.close();
  }
  return out;
}
