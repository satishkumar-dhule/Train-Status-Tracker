# 09 — QoS registry + failover orchestrator

**What to build:** Port `qos.ts` (consecutive-failure threshold, cooldown,
all-cooldown force-try) and `orchestrator.ts` (try enabled providers in order,
record QoS, classify) into `tt-qos` and `tt-orchestrator`. `GET
/api/trains/status` gains the full failover semantics: 404 only when every
consulted provider agrees not-found; 502 when all upstreams fail; cooldown
skips with force-try fallback; failover telemetry counters.

**Blocked by:** 08

**Status:** done (ready to commit)

- [x] QoS tests pass 1:1 (threshold, cooldown, force-try, reset-on-success)
- [x] orchestrator tests pass 1:1 (unanimous 404, all-error 502, mixed
  recovered, program-error rethrown, cooldown skip)
- [x] failover counters + span attribute (providers consulted) emitted
- [x] status endpoint with multiple providers returns correct classification
