# 10 — Remaining providers + registry

**What to build:** Implement `tt-provider-goibibo`, `tt-provider-railyatri`,
`tt-provider-wimt`, `tt-provider-easemytrip`, `tt-provider-railradar` behind
the shared trait, each with its quirks preserved (date formats per provider,
RailYatri today/yesterday-only, RailRadar key-gated, provider-specific missing
fields), plus a registry facade that assembles the enabled provider set from
`TRAIN_STATUS_PROVIDERS` / `RAILRADAR_API_KEY`. All six providers live in
failover.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] each provider passes its TS test file's cases 1:1
- [ ] provider quirks preserved (date format variants, missing-field handling)
- [ ] registry honours the enabled-provider env; RailRadar gated on key
- [ ] end-to-end failover chain across all providers produces correct 404/502
  classification
