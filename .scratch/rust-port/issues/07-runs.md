# 07 — Runs: time helpers + run-date probing + GET /api/trains/runs

**What to build:** Port the time/date helpers (day-rollover-aware delay calc,
YYYYMMDD validity gates, upcoming-date window, default-run-date pick) into
`tt-trains-data`, the Paytm run-date probing client, and the run resolution
logic. `GET /api/trains/runs?train_number=` returns the byte-compatible
`TrainRunsResponse`: last 3 runs up to today plus next upcoming, ascending,
empty array when unknown, 502 when the probe upstream fails.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] time helpers pass the TS test cases 1:1 (rollover, calendar validation)
- [ ] runs response matches TS golden fixtures: found / unknown / upstream-down
- [ ] run-date probing stays Paytm-only; TTL/caching behaviour preserved
