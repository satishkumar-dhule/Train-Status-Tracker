# 01 — Toolchain + Cargo workspace + CI + Makefile

**What to build:** A compiling Cargo workspace under `rust/` mirroring the TS
backend module layout, with the stable Rust toolchain pinned, a Makefile
(`build` / `test` / `check` / `fmt` / `parity`), and a CI workflow running the
gate (fmt + clippy `-D warnings`) and the test suite.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] `cargo build --workspace` green on 19 empty crates
- [x] `make check` green (fmt + clippy `-D warnings`)
- [x] `make test` green
- [x] CI workflow committed
- [x] `rust/README.md` records the deep-module seam contract
