# 06 — Fuzzy search + GET /api/trains/search

**What to build:** Port the `scoreTrain` ranking algorithm from
`lib/trains-data/src/search.ts` into `tt-trains-data` with identical ranking
(number prefix > number contains > name prefix > name contains > name-word
prefix > subsequence, deterministic tiebreak by train number) and expose
`GET /api/trains/search?q=&limit=` with `q` trimmed/max-64 and `limit` 1–100
default 10, 400 on invalid input.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] every ranking rule + tiebreak ported; golden search test cases from the
  TS test suite pass 1:1 with identical result order
- [ ] `GET /api/trains/search` response byte-identical to the TS golden fixture
- [ ] `q` validation matches Zod semantics (trim, max 64); 400 shape matches
