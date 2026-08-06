.PHONY: build test check lint fmt parity clean

# Rail Saarthi Rust backend — Slice 1 tooling.
# All commands assume the toolchain from rust-toolchain.toml.

build:
	cargo build --workspace

test:
	cargo test --workspace

# The gate CI runs: clippy with warnings as errors + fmt check.
check:
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings

lint:
	cargo clippy --workspace --all-targets -- -D warnings

fmt:
	cargo fmt --all

# Parity: boot the TS reference server and the Rust server, diff every
# endpoint's responses byte-for-byte. Implemented in Slice 13; stubbed now.
parity:
	./scripts/parity.sh

clean:
	cargo clean
