import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { CardConfig } from './connectors/types.js';
import { loadKeyring } from './crypto.js';
import { getReadings, listCards, openDb, removeCard, upsertCard } from './db.js';
import { refreshAll } from './refresh.js';
import { renderDashboard } from './views.js';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const REFRESH_MS = Number(process.env.LIBCARD_REFRESH_MINUTES || 360) * 60_000;

const db = openDb();
const kr = loadKeyring(); // fail fast if the master key is missing/wrong

// Single-flight refresh: scheduler and manual triggers share one run.
let inFlight: Promise<unknown> | null = null;
function refreshOnce(): Promise<unknown> {
  if (!inFlight) {
    inFlight = refreshAll(db, kr)
      .catch((e) => app.log.error({ err: e }, 'refresh failed'))
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

// ── Basic Auth (constant-time). Enforced when creds are configured. ──
const AUTH_USER = process.env.LIBCARD_AUTH_USER;
const AUTH_PASS = process.env.LIBCARD_AUTH_PASS;
function sha(s: string): Buffer { return createHash('sha256').update(s).digest(); }
function safeEqual(a: string, b: string): boolean { return timingSafeEqual(sha(a), sha(b)); }

if (!AUTH_USER || !AUTH_PASS) {
  app.log.warn('LIBCARD_AUTH_USER/PASS not set — UI is UNAUTHENTICATED (dev only; set them in prod).');
} else {
  app.addHook('onRequest', async (req, reply) => {
    const h = req.headers.authorization || '';
    const m = h.match(/^Basic (.+)$/);
    if (m && m[1]) {
      const [u, p] = Buffer.from(m[1], 'base64').toString('utf8').split(':', 2);
      if (u !== undefined && p !== undefined && safeEqual(u, AUTH_USER) && safeEqual(p, AUTH_PASS)) return;
    }
    reply.header('WWW-Authenticate', 'Basic realm="library-card-tracker"').code(401).send('auth required');
  });
}

// ── Routes ──
app.get('/healthz', async () => ({ ok: true }));

app.get('/', async (_req, reply) => {
  reply.type('text/html').send(renderDashboard(listCards(db), getReadings(db)));
});

app.get('/api/status', async () => {
  const readings = getReadings(db);
  return { cards: listCards(db), readings: Object.fromEntries(readings) };
});

app.post('/api/cards', async (req, reply) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const card: CardConfig = {
    id: String(b.id ?? '').trim(),
    member: String(b.member ?? '').trim(),
    system: String(b.system ?? '').trim(),
    baseUrl: String(b.baseUrl ?? '').trim(),
    limit: Number(b.limit ?? 50),
  };
  const cardNo = String(b.card ?? '').trim();
  const pin = String(b.pin ?? '');
  if (!card.id || !card.member || !card.system || !card.baseUrl || !cardNo || !pin) {
    return reply.code(400).send('id, member, system, baseUrl, card, pin are all required');
  }
  try {
    const u = new URL(card.baseUrl);
    if (u.protocol !== 'https:') return reply.code(400).send('baseUrl must be https');
  } catch {
    return reply.code(400).send('baseUrl is not a valid URL');
  }
  if (!Number.isFinite(card.limit) || card.limit <= 0) card.limit = 50;
  upsertCard(db, kr, card, { card: cardNo, pin });
  return reply.code(201).send({ ok: true });
});

app.delete('/api/cards/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  return removeCard(db, id) ? { ok: true } : reply.code(404).send('no such card');
});

app.post('/api/refresh', async () => {
  await refreshOnce();
  return { ok: true };
});

// ── Scheduler ──
if (REFRESH_MS > 0) {
  setInterval(() => { void refreshOnce(); }, REFRESH_MS).unref();
  app.log.info(`scheduled refresh every ${REFRESH_MS / 60_000} min`);
}

app.listen({ port: PORT, host: HOST }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
