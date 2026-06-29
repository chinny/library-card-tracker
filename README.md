# library-card-tracker

Track **physical checkout capacity** across multiple [SirsiDynix Enterprise](https://www.sirsidynix.com/) library cards from one place, so you can see at a glance which card has room before checking out — without logging into each account by hand.

A real browser (Playwright) logs into each card and reads the patron dashboard's status panel (checkouts, holds, fines). Both physical and digital checkouts are reported; only **physical** is compared against the per-card limit (digital is informational).

> This repo is intentionally **generic**. No real library hostnames, card numbers, PINs, or names live here — those go in a gitignored `config.json` and credentials (later: an encrypted local store / k8s Secret). Committed files use placeholder examples only.

## Status
**Feature-complete (Phases 1–6).** Connector, encrypted SQLite store + CLI, web dashboard (card UI, scheduler, on-demand refresh, Basic Auth), Prometheus `/metrics` with example Grafana dashboard + alerts, container + k8s/compose example manifests, and an installable PWA. See the project plan in `chinny/notes/projects/library-card-app.md`.

## Setup
```sh
npm install
npx playwright install chromium        # + system deps: npx playwright install-deps chromium
```

### Phase 2 — encrypted store + CLI (the real path)
Cards are stored in SQLite with the **barcode and PIN encrypted at rest** (AES-256-GCM).
The master key lives in the environment (a k8s Secret in prod), never in the DB.

```sh
npm run cli -- gen-key                  # generate a base64 master key → put in .env / Secret
export LIBCARD_MASTER_KEY=<that key>

# Import cards from config.json + the Phase-1 env creds into the encrypted DB:
cp config.example.json config.json && $EDITOR config.json
cp .env.example .env && $EDITOR .env     # LIBCARD_<ID>_CARD / _PIN per card
set -a && . ./.env && set +a
npm run cli -- import-config

npm run cli -- list                     # cards, no secrets
npm run cli -- refresh                  # fetch all, store + print readings
npm run cli -- add --id x --member "..." --system y --base-url https://...  # CARD/PIN from env
npm run cli -- rm <id>
```
Once imported, only `LIBCARD_MASTER_KEY` is needed at runtime — the per-card env creds were just the import source.

### Phase 3 — web dashboard
```sh
export LIBCARD_MASTER_KEY=<your key>     # same key used to import the cards
export LIBCARD_AUTH_USER=you LIBCARD_AUTH_PASS=somepass   # Basic Auth (skip = unauthenticated, dev only)
npm run serve                            # http://localhost:8080
```
Shows a capacity grid (physical `n/50`, color-coded by slots left; digital/holds/fines as info), an **Add card** form, per-card **remove**, and a **Refresh now** button. A background scheduler re-reads every `LIBCARD_REFRESH_MINUTES` (default 360).

Env: `PORT` (8080), `HOST` (0.0.0.0), `LIBCARD_DB` (data/library.sqlite), `LIBCARD_REFRESH_MINUTES` (360; 0 disables), `LIBCARD_AUTH_USER`/`LIBCARD_AUTH_PASS`.

### Phase 4 — metrics & monitoring
`GET /metrics` exposes Prometheus gauges (no auth needed, no secrets — labeled by
`card`/`member`/`system` only): `library_checkouts_physical`, `library_remaining`,
`library_checkouts_digital`, `library_holds_library`, `library_holds_digital`,
`library_fines_dollars`, `library_checkout_limit`, `library_scrape_success`,
`library_scrape_timestamp_seconds`. Rendered on-demand from the DB, so they survive restarts.

Deploy artifacts in `deploy/monitoring/`:
- `prometheus-rules.yaml` — alerts: scrape failing, data stale, card near limit.
- `grafana-dashboard.json` — starter dashboard (remaining slots, scrape health, checkouts over time).

### Phase 5 — container & deploy examples
```sh
docker compose up --build     # local: needs .env with LIBCARD_MASTER_KEY
```
- `Dockerfile` — multi-stage; runtime is the Playwright image (Chromium + deps baked in), runs compiled JS as non-root.
- `docker-compose.yml` — local single-container run with a named data volume.
- `deploy/k8s/` — **example** manifests (not wired to a cluster): namespace, Secret (master key + auth), PVC, Deployment (hardened: non-root, read-only FS, dropped caps), Service, Ingress, NetworkPolicy + Cilium FQDN egress allowlist, ServiceMonitor. See `deploy/k8s/README.md` for apply order.

### Phase 6 — install on Android (PWA)
The dashboard is an installable PWA: open it in Chrome on Android → menu → **Add to
Home Screen**. It launches standalone with an app icon, and a service worker shows
the last-known capacity when offline. Manifest, service worker, and icon are served
from the app (`/manifest.webmanifest`, `/sw.js`, `/icons/icon.svg`) — no files to ship.
(Installability needs HTTPS — use the Ingress TLS host, not plain `localhost:8080`.)

### Phase 1 — env-only harness (no DB)
```sh
cp config.example.json config.json && cp .env.example .env   # fill both in
set -a && . ./.env && set +a
npm run dev                             # prints a capacity table straight from env creds
```
Each card in `config.json` needs `LIBCARD_<ID>_CARD` / `LIBCARD_<ID>_PIN` (id upper-cased, non-alphanumerics → `_`).

## Roadmap
1. ✅ Connector + CLI harness (generic SirsiDynix Enterprise)
2. ✅ Persistence — SQLite (node:sqlite); barcode + PIN encrypted at rest (AES-256-GCM); management CLI
3. ✅ Card management UI + capacity dashboard + scheduler + Basic Auth
4. ✅ Prometheus `/metrics` → Grafana dashboard + scrape-failure alerts
5. ✅ Container + k8s/compose example manifests (PVC, NetworkPolicy, ServiceMonitor)
6. ✅ PWA (installable on Android)

## Security notes
- PINs must be **replayed** to the library, so they are **encrypted at rest, not hashed**; the master key lives outside the DB (k8s Secret).
- No debug screenshots / Playwright traces / HAR in production (they leak PII + credentials); such artifacts are gitignored.
- Credentials are never logged, returned via API, or exposed in metrics. Internal-only exposure, Basic Auth in front of the UI.
