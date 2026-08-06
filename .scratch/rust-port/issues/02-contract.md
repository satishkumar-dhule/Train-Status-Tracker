# 02 — Contract crate: wire types + validation

**What to build:** The `tt-contract` crate: serde structs for every OpenAPI
schema in `lib/api-spec/openapi.yaml` (HealthStatus, ErrorResponse, TrainEntry,
TrainCatalogResponse, TrainSearchResponse, TrainRunsResponse, StationStatus,
TrainStatusResponse) and query-param validation that reproduces the `api-zod`
semantics exactly: train number `^\d{5}$`, departure date `^\d{8}$`
(YYYYMMDD), `q` trimmed with max length 64, `limit` coerced int 1–100 default
10. All nullable fields must serialize as explicit `null` (nullish parity).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `HealthStatus` serializes byte-identical to the TS `HealthCheckResponse`
- [ ] `TrainStatusResponse`/`StationStatus` match the spec field-for-field
  including nullability
- [ ] invalid train number / date / over-length `q` rejected; `q` trimmed;
  `limit` defaults and clamps as the Zod schemas do
- [ ] golden-fixture round-trip test: parse + reserialize a captured TS JSON
  payload is byte-identical
