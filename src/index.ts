import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fetchAccount } from './connectors/sirsidynix.js';
import type { AccountStatus, CardConfig, Credentials } from './connectors/types.js';

// Phase-1 CLI runner: reads card definitions from ./config.json (gitignored) and
// credentials from env vars, then prints a status table. This env-based credential
// path is a DEV/TEST harness — Phase 2 replaces it with the encrypted SQLite store.
//
// For each card id "foo", set:  LIBCARD_FOO_CARD=...  LIBCARD_FOO_PIN=...

interface Config {
  cards: CardConfig[];
}

function envKey(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function credsFor(card: CardConfig): Credentials | null {
  const k = envKey(card.id);
  const cardNo = process.env[`LIBCARD_${k}_CARD`];
  const pin = process.env[`LIBCARD_${k}_PIN`];
  if (!cardNo || !pin) return null;
  return { card: cardNo, pin };
}

async function loadConfig(): Promise<Config> {
  const raw = await readFile(new URL('../config.json', import.meta.url), 'utf8').catch(() => {
    throw new Error('config.json not found — copy config.example.json to config.json and fill it in');
  });
  const cfg = JSON.parse(raw) as Config;
  if (!Array.isArray(cfg.cards) || cfg.cards.length === 0) {
    throw new Error('config.json has no cards');
  }
  for (const c of cfg.cards) c.limit ??= 50;
  return cfg;
}

function printRow(s: AccountStatus): void {
  if (!s.ok) {
    console.log(`✗ ${s.member.padEnd(12)} ${s.system.padEnd(12)} ERROR: ${s.error}`);
    return;
  }
  const cap = `${s.physical}/${s.limit}`;
  const flag = s.remaining !== null && s.remaining <= 5 ? '⚠️ ' : '   ';
  console.log(
    `✓ ${s.member.padEnd(12)} ${s.system.padEnd(12)} ${flag}physical ${cap.padEnd(7)} ` +
      `(remaining ${s.remaining})  digital ${s.digital}  holds ${s.holdsLibrary}/${s.holdsDigital}  fines $${s.finesDue}`,
  );
}

async function main(): Promise<void> {
  const cfg = await loadConfig();
  const browser = await chromium.launch();
  try {
    // Sequential, gentle polling — avoid hammering the libraries.
    for (const card of cfg.cards) {
      const creds = credsFor(card);
      if (!creds) {
        console.log(
          `✗ ${card.member.padEnd(12)} ${card.system.padEnd(12)} SKIP: no creds in env ` +
            `(set LIBCARD_${envKey(card.id)}_CARD / _PIN)`,
        );
        continue;
      }
      const status = await fetchAccount(browser, card, creds);
      printRow(status);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('fatal:', (e as Error).message);
  process.exit(1);
});
