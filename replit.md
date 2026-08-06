# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: none for telemetry — the API server and SPA both stay on the no-op providers until an OTLP endpoint is configured. See `.env.example` for the full reference.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Train status upstreams: `artifacts/api-server/src/lib/providers/` — one adapter per upstream (Paytm, Goibibo, RailYatri, WhereIsMyTrain, EaseMyTrip, RailRadar), a shared HTTP transport + normalizer, a failover orchestrator, and an env-driven registry.
- Paytm raw fetch (still used by run-date probing): `artifacts/api-server/src/lib/paytm-client.ts`
- Normalization contract: `artifacts/api-server/src/lib/train-status-mapper.ts` (`MappedStatus`/`MappedStation`) — shared by every provider via `lib/providers/normalize.ts`.

## Architecture decisions

- **Provider abstraction (deep modules).** Each upstream is a small `TrainStatusProvider` implementing `fetchTrainStatus(trainNumber, departureDate, options, knownTrain)`. Providers own their endpoint, date format, auth and parsing; the shared `http.ts` owns transport (timeouts, redaction, spans, metrics) and `normalize.ts` owns the single `ProviderStationRow -> MappedStatus` mapping path (DRY).
- **Failover via `fetchStatusWithFailover` (orchestrator).** Providers run in priority order (env `TRAIN_STATUS_PROVIDERS`, default `paytm,goibibo,railyatri,whereismytrain,easemytrip,railradar`). A 404 is only served when **every** enabled provider agrees "not found"; any ambiguous/errored provider turns the response into 502 so a flaky upstream can never poison the shared negative cache.
- **ZTA ("zero trust") mapping.** All upstream payloads are untrusted: `parse.ts` coercions make unknown fields null/false instead of throwing, and each adapter classifies not-found vs upstream error conservatively (only positively-confirmed "failure" markers are 404s).
- **RailRadar is opt-in.** Requires `RAILRADAR_API_KEY`; silently disabled otherwise (registry skips disabled providers).
- **RailYatri date constraint.** Its API has no date param — only today (`start_day=0`) or yesterday (`start_day=1`); other dates are rejected as upstream errors so the orchestrator can fail over.
- **Per-provider QoS + circuit breaking.** Every status lookup is recorded in the QoS registry (`lib/providers/qos.ts`): outcome, latency (avg/p95), timeouts, error rate, consecutive failures. After `TRAIN_STATUS_QOS_FAILURE_THRESHOLD` (default 3) consecutive upstream errors a provider is skipped for `TRAIN_STATUS_QOS_COOLDOWN_MS` (default 60s) instead of burning its full timeout on every request; if *all* providers are in cooldown the first is still force-tried so availability never regresses. The registry is per-instance (in-memory); OTel counters/histograms in `http.ts` remain the long-lived cross-instance view.
- **QoS status endpoint.** `GET /api/trains/providers` returns a snapshot per enabled provider (counts, error rate, avg/p95 latency, circuit-breaker status, last error). Ops-only; not in the OpenAPI spec or generated clients.
- **App-side status cache.** The frontend caches running-status payloads in TanStack Query and serves them without touching the backend while younger than `VITE_STATUS_CACHE_TTL_MS` (default 5 min; see `artifacts/train-tracker/src/lib/status-cache.ts`). `gcTime` is the TTL plus a 60s buffer so a fresh entry is never GC'd the instant it goes stale. The explicit Retry button still force-refetches.
- **Refresh + auto-refresh (frontend).** The status hero exposes a manual Refresh button (force-refetches via the hook's `refetch`, bypassing staleness) and an opt-in Auto-refresh toggle (`useAutoRefresh`, persisted to localStorage, default OFF). When ON, `useTrainStatus` sets TanStack `refetchInterval` to `VITE_AUTO_REFRESH_INTERVAL_MS` (default 30s — aligned with the server's 30s L1 cache so polls hit the cache, not upstreams; see `lib/auto-refresh.ts`). Polling never runs for disabled/held queries, and stops when the toggle is off or the tab is hidden.
- **End-to-end observability.** API (`artifacts/api-server/src/lib/telemetry.ts`) and SPA (`artifacts/train-tracker/src/lib/telemetry/`) bootstrap OTel SDKs behind env flags; both default to disabled. API: host + runtime + HTTP/Redis auto-instrumentation, PII redaction (query strings, peer IPs), HTTP/RED metrics, per-provider failover/QoS counters, enriched `/api/healthz`. SPA: RUM via WebTracerProvider + `@opentelemetry/sdk-metrics` (NOT `sdk-metrics-web` — absent from the Replit package mirror), W3C `traceparent` propagation to the API origin, web-vitals histograms, buffered window-error spans, business spans in `lib/telemetry/queries.ts`. The `pnpm-workspace` skill and `.env.example` list the env keys; `render.yaml` shows the production wiring (commented-out collector endpoints).
- **Codegen wipes hand-edits.** `pnpm --filter @workspace/api-spec run codegen` runs orval with `clean: true`, so it deletes anything hand-written inside the generated dirs (`lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`). The committed `api.test.ts` and the `.trim()` on `SearchTrainsQueryParams.q` (a security hardening orval can't emit) are re-applied by hand after every regen — keep them in sync when you touch the spec.

## Gotchas

- `probeTrainRuns` in `lib/train-runs.ts` intentionally stays on Paytm only — failover across 6 providers × 21 probe dates would be 126 upstream calls.
- WhereIsMyTrain returns station codes without names; EaseMyTrip returns no actual (only scheduled) times. Both degrade gracefully in the shared contract.
- Date formats: Paytm/API use `YYYYMMDD`; Goibibo/WIMT `DD-MM-YYYY`; EaseMyTrip `DD/MM/YYYY`; RailYatri uses `start_day`; RailRadar `DD-MM-YYYY`.
- Route/redis tests stub `fetch` URL-aware per provider — a single "not found" body no longer works for all upstreams.
- Route tests reset `defaultQosRegistry` in `afterEach`/`beforeEach` so the circuit breaker can't trip across tests; new tests pass their own `QosRegistry` where they assert on it.
- OTel sdk-node 0.221: only the **first** `NodeSDK` started in a process exports spans — a second `start()` (or one after `shutdown()`) records but silently drops exports. Production calls `initTelemetry` once per process, so this only bites tests that assert exported spans after a prior SDK lifecycle; unit-test resource merging via the exported `buildResource` instead.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
