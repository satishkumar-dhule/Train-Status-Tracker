# 03 — Config + logging + telemetry skeletons

**What to build:** The `tt-config`, `tt-logging` and `tt-telemetry` crates.
`config` parses every env var the TS server reads (PORT, LOG_LEVEL,
REDIS_MODE/URL/GZIP, CORS_ORIGIN, TRAIN_STATUS_PROVIDERS, RAILRADAR_API_KEY,
TRAIN_DATA_URL, TRAIN_CATALOG_TTL_MS, OTEL_*, SERVICE_VERSION,
TRAIN_STATUS_QOS_*, VITE-independent) with the same defaults and fail-open
semantics. `logging` sets up structured JSON logs. `telemetry` provides the
tracer/meter handles and RED-metrics helpers used by later slices, inert when
OTel is disabled.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] config has a type for every TS env var with matching default + parse rules
- [ ] missing optional env vars never crash startup (fail-open)
- [ ] logger emits pino-shaped JSON lines at the configured level
- [ ] telemetry init is a no-op unless enabled; tracer + meter handles are
  obtainable and no-op when disabled
