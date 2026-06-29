import { readFile } from 'node:fs/promises';
import type { CardConfig, Credentials } from './connectors/types.js';
import { generateKeyBase64, loadKeyring } from './crypto.js';
import { listCards, openDb, removeCard, upsertCard, type Db } from './db.js';
import { refreshAll } from './refresh.js';
import { printRow } from './report.js';

// DB-backed management CLI (Phase 2). Replaces the env-only harness in index.ts.
//
//   npm run cli -- gen-key                 print a fresh base64 master key
//   npm run cli -- import-config           load config.json + env creds into the DB
//   npm run cli -- add --id X --member ..  add/update one card (CARD/PIN from env)
//   npm run cli -- list                    list cards (no secrets)
//   npm run cli -- rm <id>                 remove a card
//   npm run cli -- refresh                 fetch all cards, store + print readings
//
// All commands except gen-key need LIBCARD_MASTER_KEY in the environment.

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function envKey(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

async function cmdImportConfig(db: Db): Promise<void> {
  const kr = loadKeyring();
  const raw = await readFile(new URL('../config.json', import.meta.url), 'utf8').catch(() => {
    throw new Error('config.json not found');
  });
  const cfg = JSON.parse(raw) as { cards: CardConfig[] };
  let n = 0;
  for (const card of cfg.cards) {
    card.limit ??= 50;
    const k = envKey(card.id);
    const cardNo = process.env[`LIBCARD_${k}_CARD`];
    const pin = process.env[`LIBCARD_${k}_PIN`];
    if (!cardNo || !pin) {
      console.log(`skip ${card.id}: no LIBCARD_${k}_CARD / _PIN in env`);
      continue;
    }
    upsertCard(db, kr, card, { card: cardNo, pin });
    console.log(`imported ${card.id} (${card.member} / ${card.system})`);
    n++;
  }
  console.log(`done — ${n} card(s) stored (encrypted).`);
}

function cmdAdd(db: Db, args: string[]): void {
  const kr = loadKeyring();
  const card: CardConfig = {
    id: flag(args, 'id') ?? '',
    member: flag(args, 'member') ?? '',
    system: flag(args, 'system') ?? '',
    baseUrl: flag(args, 'base-url') ?? '',
    limit: Number(flag(args, 'limit') ?? 50),
  };
  if (!card.id || !card.member || !card.system || !card.baseUrl) {
    throw new Error('add requires --id --member --system --base-url (and optional --limit)');
  }
  const creds: Credentials = { card: process.env.CARD ?? '', pin: process.env.PIN ?? '' };
  if (!creds.card || !creds.pin) throw new Error('set CARD and PIN in env for `add` (keep them out of argv)');
  upsertCard(db, kr, card, creds);
  console.log(`stored ${card.id} (${card.member} / ${card.system})`);
}

function cmdList(db: Db): void {
  const cards = listCards(db);
  if (cards.length === 0) {
    console.log('no cards. add some with `import-config` or `add`.');
    return;
  }
  for (const c of cards) {
    console.log(`${c.id.padEnd(20)} ${c.member.padEnd(14)} ${c.system.padEnd(12)} limit ${c.limit}  ${c.baseUrl}`);
  }
}

async function cmdRefresh(db: Db): Promise<void> {
  const kr = loadKeyring();
  const statuses = await refreshAll(db, kr);
  if (statuses.length === 0) {
    console.log('no cards to refresh.');
    return;
  }
  for (const s of statuses) printRow(s);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'gen-key') {
    console.log(generateKeyBase64());
    return;
  }

  const db = openDb();
  try {
    switch (cmd) {
      case 'import-config': await cmdImportConfig(db); break;
      case 'add': cmdAdd(db, args); break;
      case 'list': cmdList(db); break;
      case 'rm': {
        const id = args[0];
        if (!id) throw new Error('rm requires an id');
        console.log(removeCard(db, id) ? `removed ${id}` : `no card with id "${id}"`);
        break;
      }
      case 'refresh': await cmdRefresh(db); break;
      default:
        console.log('commands: gen-key | import-config | add | list | rm <id> | refresh');
    }
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error('error:', (e as Error).message);
  process.exit(1);
});
