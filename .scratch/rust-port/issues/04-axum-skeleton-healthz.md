# 04 — Axum skeleton + /api/healthz end-to-end

**What to build:** The `tt-api-server` crate booting an axum server on PORT
with CORS (CORS_ORIGIN), security headers, a pino-logged request path, and a
404/error handler producing the `{ "error": string }` shape. `GET /api/healthz`
returns a byte-compatible `HealthStatus` (status, redis up/down/disabled,
uptime_seconds, version, timestamp). This is the first vertical slice — the
whole stack working end to end.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] `GET /api/healthz` response byte-identical to the TS server
  (compare against a captured golden fixture)
- [ ] unknown route returns the spec `ErrorResponse` shape with correct status
- [ ] CORS honours `CORS_ORIGIN`; security headers present
- [ ] request logging + a status metric emitted per request
- [ ] `main` wires config → logging → telemetry → server; graceful shutdown
