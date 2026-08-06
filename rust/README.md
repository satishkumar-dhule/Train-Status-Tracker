# Rail Saarthi — Rust backend

Byte-compatible port of the TypeScript `artifacts/api-server` into a Rust
Cargo workspace. The React SPA (`artifacts/train-tracker`) is untouched and
talks to this server over the same HTTP contract.

## Crates (deep modules)

Every crate is a **deep module**: a small public interface in `lib.rs` with the
implementation hidden in private submodules, tested across that same seam. The
table below is the seam contract — the interface is the test surface. Do not
reach past a crate's `lib.rs` surface.

| Crate | Public interface (the seam) | Hidden implementation | TS counterpart |
|---|---|---|---|
| `contract` | serde wire types + query-param validation | nullability, zod-coercion semantics | `lib/api-zod` |
| `trains-data` | `search_trains`, `TRAINS`, time/date fns | `scoreTrain`, dataset format, fetcher fail-open | `lib/trains-data` |
| `provider-core` | `TrainStatusProvider` trait, `KnownTrain`, error enum | — | `providers/types.ts` |
| `provider-http` | `Client` (timeouts, redirect cap, abort, max bytes) | reqwest wrapping | `providers/http.ts` |
| `provider-{paytm,goibibo,railyatri,wimt,easemytrip,railradar}` | `Provider::new(cfg)` + trait impl | URL, auth, date format, payload parsing | `providers/*.ts` |
| `mapper` | `MappedStatus`/`MappedStation` | ZTA untrusted-payload mapping | `train-status-mapper.ts` |
| `orchestrator` | `fetch_status_with_failover` | unanimity-404, 502, cooldown force-try | `providers/orchestrator.ts` |
| `qos` | `QosRegistry` | thresholds, cooldown | `providers/qos.ts` |
| `cache` | `Cache::get/put(key, ttl)` | L1 TTL single-flight + L2 Redis + gzip | `ttl-cache.ts` + `redis-cache.ts` |
| `rate-limit` | `check(key) -> Result` | sliding window | `rate-limit.ts` |
| `config` | typed `Config` | env parsing | `lib/env.ts` |
| `logging` | structured logger | tracing-subscriber, pino-equivalent JSON | `lib/logger.ts` |
| `telemetry` | OTel init, spans, RED metrics | trace propagation, exporters | `lib/telemetry.ts` |
| `api-server` | axum app, routes, middleware, `main` | CORS, security headers, error shape | `app.ts` + `routes/*` |

## Wire-compat invariants (hard gate)

- Train number `^\d{5}$`; departure date `^\d{8}$` (YYYYMMDD); `q` trimmed, max 64; `limit` 1–100 default 10.
- Error body `{ "error": string }`.
- `last_updated` ISO-8601, parseable by `Date.parse`.
- `runs[]` empty when unknown.
- 404 only when **every** consulted provider agrees not-found; 502 when all upstreams fail.
- Ops endpoint `GET /api/trains/providers` (not in the OpenAPI spec).

## Commands

```sh
make check   # fmt check + clippy -D warnings
make test    # cargo test --workspace
make build
make parity  # Slice 13: boot TS + Rust servers, diff responses
```

## Slice map

See `tickets` in the plan. Slices: 1 toolchain/workspace (this), 2 contract,
3 config/logging/telemetry, 4 axum skeleton + `/api/healthz`, 5 catalog,
6 search, 7 runs, 8 status tracer (Paytm), 9 QoS + failover, 10 remaining
providers, 11 caches, 12 rate-limit + ops, 13 e2e parity + hardening.
