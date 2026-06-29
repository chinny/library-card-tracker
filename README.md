# library-card-tracker

Track **physical checkout capacity** across multiple [SirsiDynix Enterprise](https://www.sirsidynix.com/) library cards from one place, so you can see at a glance which card has room before checking out — without logging into each account by hand.

A real browser (Playwright) logs into each card and reads the patron dashboard's status panel (checkouts, holds, fines). Both physical and digital checkouts are reported; only **physical** is compared against the per-card limit (digital is informational).

> This repo is intentionally **generic**. No real library hostnames, card numbers, PINs, or names live here — those go in a gitignored `config.json` and credentials (later: an encrypted local store / k8s Secret). Committed files use placeholder examples only.

## Status
Early build. **Phase 1** (connector) and **Phase 2** (encrypted SQLite store + management CLI) are in place. Web UI, metrics, and container/k3s deploy are planned. See the project plan in `chinny/notes/projects/library-card-app.md`.

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
3. Card management UI + capacity dashboard + scheduler
4. Secrets — master key from k8s Secret; Basic Auth in front of the UI
5. Prometheus `/metrics` → Grafana + scrape-failure alerts
6. Containerize + k3s (PVC, NetworkPolicy, ServiceMonitor)
7. PWA (installable on Android)

## Security notes
- PINs must be **replayed** to the library, so they are **encrypted at rest, not hashed**; the master key lives outside the DB (k8s Secret).
- No debug screenshots / Playwright traces / HAR in production (they leak PII + credentials); such artifacts are gitignored.
- Credentials are never logged, returned via API, or exposed in metrics. Internal-only exposure, Basic Auth in front of the UI.
