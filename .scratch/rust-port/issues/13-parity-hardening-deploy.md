# 13 — E2E parity, hardening review, deployment

**What to build:** The acceptance slice. A parity harness boots the TS
reference server and the Rust server and diffs every endpoint byte-for-byte.
The full SPA (unchanged React app) runs against the Rust server and its
existing vitest suite passes. A hardening review ports the security findings
from the TS server's prior security pass (BF22FD9). Deployment config
(render.yaml / run docs) is updated for the Rust binary.

**Blocked by:** 10, 11, 12

**Status:** ready-for-agent

- [ ] `make parity` green: all 5 endpoints + ops byte-identical vs TS server
- [ ] SPA vitest suite passes unchanged against the Rust API
- [ ] hardening review findings addressed (headers, validation, error
  handling, secret handling)
- [ ] deployment docs/config updated for the Rust service
