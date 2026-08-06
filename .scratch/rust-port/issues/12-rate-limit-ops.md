# 12 — Rate limiter + Redis health + ops endpoint

**What to build:** Port `rate-limit.ts` (per-key sliding window, applied to the
provider-heavy endpoints) into `tt-rate-limit`; port Redis health reporting
into `/api/healthz`'s `redis` field (up/down/disabled); expose the ops-only
`GET /api/trains/providers` QoS status endpoint (not in the OpenAPI spec) with
the same shape as the TS route.

**Blocked by:** 04, 11

**Status:** ready-for-agent

- [ ] rate-limit tests pass 1:1; 429 shape matches
- [ ] `healthz.redis` reports up/down/disabled matching TS semantics
- [ ] `/api/trains/providers` response byte-identical to the TS ops route
