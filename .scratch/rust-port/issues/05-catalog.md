# 05 — Train dataset + fetcher + GET /api/trains

**What to build:** The `tt-trains-data` crate ships the 370-train static
dataset (embedded, mirroring the TS bundled `TRAINS` array) and a fail-open
fetcher for the upstream NTES `train_data.js` (TTL 2h, 10s timeout, max 3
redirects, 5 MiB cap, single-flight, fall back to the embedded set). The
`tt-api-server` exposes `GET /api/trains` returning the byte-compatible
`TrainCatalogResponse`, with the same 2h catalog TTL semantics.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] embedded dataset has all 370 train entries identical to the TS source
- [ ] fetcher fail-open: upstream down → embedded data, no error
- [ ] `GET /api/trains` response byte-identical to the TS server golden fixture
- [ ] catalog fetch is single-flight and honours the 2h TTL
