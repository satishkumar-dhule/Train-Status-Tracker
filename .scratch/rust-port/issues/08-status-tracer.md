# 08 — Status tracer: provider-core + mapper + http + Paytm + GET /api/trains/status

**What to build:** The status path as a single vertical slice. `tt-provider-core`
defines the `TrainStatusProvider` trait (name, enabled, fetch_train_status)
and the error enum (NotFound / Upstream / Program). `tt-mapper` ports the ZTA
normalization contract (`MappedStatus`/`MappedStation`). `tt-provider-http`
provides the shared transport (timeouts, redirect cap, abort, max bytes).
`tt-provider-paytm` implements the trait (URL, auth, date format, payload
parsing, known-train name rendering). `GET /api/trains/status` works end to
end with Paytm alone, before any QoS/failover.

**Blocked by:** 02, 04

**Status:** done (committed `0291e88`)

- [x] provider trait tests: each TS paytm test case passes 1:1 (parse,
  normalize, not-found, upstream error, timeout)
- [x] mapper golden tests: untrusted payloads map to `MappedStatus` exactly as
  the TS mapper does
- [x] `GET /api/trains/status` with Paytm only matches the TS golden fixture
  (fields, nullability, `last_updated` ISO-8601)
- [x] 404 when Paytm reports not found; 502 on upstream failure
