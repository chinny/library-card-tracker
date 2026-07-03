import type { CardConfig } from './connectors/types.js';
import type { ReadingRow } from './db.js';

// Prometheus exposition rendered on demand from the latest stored readings, so
// metrics survive restarts and never drift from the DB. No secrets are exposed —
// labels are the opaque card id / member / system only, never the barcode or PIN.

function escLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(card: CardConfig): string {
  return `card="${escLabel(card.id)}",member="${escLabel(card.member)}",system="${escLabel(card.system)}"`;
}

interface Family {
  name: string;
  help: string;
  /** Value for a card, or null to omit the line. */
  value: (card: CardConfig, r: ReadingRow | undefined) => number | null;
}

const FAMILIES: Family[] = [
  {
    name: 'library_scrape_success',
    help: 'Whether the most recent read of this card succeeded (1) or failed (0).',
    value: (_c, r) => (r ? (r.ok ? 1 : 0) : 0),
  },
  {
    name: 'library_scrape_timestamp_seconds',
    help: 'Unix time of the most recent read attempt for this card.',
    value: (_c, r) => (r ? Math.floor(new Date(r.fetched_at).getTime() / 1000) : null),
  },
  {
    name: 'library_last_success_timestamp_seconds',
    help: 'Unix time of the most recent successful read for this card (data age).',
    value: (_c, r) =>
      r?.last_success_at ? Math.floor(new Date(r.last_success_at).getTime() / 1000) : null,
  },
  {
    name: 'library_checkout_limit',
    help: 'Configured physical checkout limit for this card.',
    value: (c) => c.limit,
  },
  // Data gauges report the last successful sync's values even when the latest
  // attempt failed (library_scrape_success flags that; last_success shows age).
  {
    name: 'library_checkouts_physical',
    help: 'Physical items currently checked out (from the last successful read).',
    value: (_c, r) => (r?.last_success_at ? r.physical : null),
  },
  {
    name: 'library_remaining',
    help: 'Remaining physical checkout slots (limit - physical).',
    value: (_c, r) => (r?.last_success_at ? r.remaining : null),
  },
  {
    name: 'library_checkouts_digital',
    help: 'Digital loans currently out (informational; not capped here).',
    value: (_c, r) => (r?.last_success_at ? r.digital : null),
  },
  {
    name: 'library_holds_library',
    help: 'Physical holds currently placed.',
    value: (_c, r) => (r?.last_success_at ? r.holds_library : null),
  },
  {
    name: 'library_holds_digital',
    help: 'Digital holds currently placed.',
    value: (_c, r) => (r?.last_success_at ? r.holds_digital : null),
  },
  {
    name: 'library_fines_dollars',
    help: 'Outstanding fines in dollars.',
    value: (_c, r) => (r?.last_success_at ? r.fines_due : null),
  },
];

export function renderMetrics(cards: CardConfig[], readings: Map<string, ReadingRow>): string {
  const lines: string[] = [];
  for (const fam of FAMILIES) {
    lines.push(`# HELP ${fam.name} ${fam.help}`);
    lines.push(`# TYPE ${fam.name} gauge`);
    for (const card of cards) {
      const v = fam.value(card, readings.get(card.id));
      if (v !== null && Number.isFinite(v)) lines.push(`${fam.name}{${labels(card)}} ${v}`);
    }
  }
  return lines.join('\n') + '\n';
}
