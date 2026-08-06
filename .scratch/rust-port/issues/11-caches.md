# 11 — Caches: L1 TTL + L2 Redis wired in

**What to build:** Port `ttl-cache.ts` (in-process TTL, single-flight) and
`redis-cache.ts`/`redis-client.ts` (Redis L2 with the same keys and
serialization, gzip per `REDIS_GZIP`, mode auto/manual/disabled) into the
`tt-cache` crate. Wire L1/L2 into catalog (2h), status (30s), and runs.
Redis keys and value encoding must interoperate with the TS server so both
servers can share the cache.

**Blocked by:** 05, 09

**Status:** ready-for-agent

- [ ] L1 TTL + single-flight tests pass 1:1
- [ ] Redis key layout + gzip encoding identical to TS (cross-server
  interop test reads a value written by the TS server)
- [ ] REDIS_MODE auto/manual/disabled and REDIS_URL honoured; Redis down is
  fail-open
- [ ] status served from L1 within 30s TTL; catalog 2h; runs cached
