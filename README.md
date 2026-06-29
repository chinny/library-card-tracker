# library-card-tracker

Track **physical checkout capacity** across multiple [SirsiDynix Enterprise](https://www.sirsidynix.com/) library cards from one place, so you can see at a glance which card has room before checking out — without logging into each account by hand.

A real browser (Playwright) logs into each card and reads the patron dashboard's status panel (checkouts, holds, fines). Both physical and digital checkouts are reported; only **physical** is compared against the per-card limit (digital is informational).

> This repo is intentionally **generic**. No real library hostnames, card numbers, PINs, or names live here — those go in a gitignored `config.json` and credentials (later: an encrypted local store / k8s Secret). Committed files use placeholder examples only.

## Status
Early build. **Phase 1** (connector + CLI harness) is in place; persistence, web UI, metrics, and container/k3s deploy are planned. See the project plan in `chinny/notes/projects/library-card-app.md`.

## Quick start (Phase 1 CLI)
```sh
npm install
npx playwright install chromium        # + system deps: npx playwright install-deps chromium

cp config.example.json config.json     # fill in your cards (gitignored)
cp .env.example .env                    # fill in card #/PIN per card id (gitignored)

set -a && . ./.env && set +a            # load creds into env
npm run dev                             # prints a capacity table
```

Each card in `config.json` needs a matching credential pair in the environment:
`LIBCARD_<ID>_CARD` and `LIBCARD_<ID>_PIN` (id upper-cased, non-alphanumerics → `_`).

## Roadmap
1. ✅ Connector + CLI harness (generic SirsiDynix Enterprise)
2. Persistence — SQLite; PINs encrypted at rest (AES-256-GCM)
3. Card management UI + capacity dashboard + scheduler
4. Crypto/secrets — master key from k8s Secret; Basic Auth in front of the UI
5. Prometheus `/metrics` → Grafana + scrape-failure alerts
6. Containerize + k3s (PVC, NetworkPolicy, ServiceMonitor)
7. PWA (installable on Android)

## Security notes
- PINs must be **replayed** to the library, so they are **encrypted at rest, not hashed**; the master key lives outside the DB (k8s Secret).
- No debug screenshots / Playwright traces / HAR in production (they leak PII + credentials); such artifacts are gitignored.
- Credentials are never logged, returned via API, or exposed in metrics. Internal-only exposure, Basic Auth in front of the UI.
