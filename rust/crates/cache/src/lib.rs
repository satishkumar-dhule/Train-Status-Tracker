//! Rail Saarthi — `tt-cache` crate.
//!
//! Cache of the train-status route, ported 1:1 from the TypeScript server:
//!
//! - `src/store.rs` — ports `lib/redis-client.ts`: the [`RedisStore`] trait,
//!   [`parse_redis_config`], the health controller (port of
//!   `createRedisHealth`), and the real connection behind the `real-client`
//!   feature.
//! - `src/l2.rs` — ports `lib/redis-cache.ts`: the fail-open, TTL-jittered,
//!   gzip-capable [`RedisTtlCache`] layered on any [`RedisStore`].
//! - `src/l1.rs` — ports `lib/ttl-cache.ts`: the in-memory single-flight
//!   [`TtlCache`] with injectable clock and bounded capacity.
//!
//! Deep module: the public surface below is the whole contract. Implementation
//! lives in private submodules, tested through this surface (and the
//! [`RedisStore`] / [`RedisHealthClient`] fakes) only.
//!
//! # Layering
//!
//! The route production is a `TtlCache` (L1) whose producer consults the
//! `RedisTtlCache` (L2) and, on upstream success, writes back a positive value
//! or a "not found" marker (`setNegative`). Redis failures are fail-open: a
//! `get` falls through to a miss and `set`/`setNegative` are no-ops, exactly
//! like the TypeScript server.

mod l1;
mod l2;
mod store;

#[cfg(feature = "testkit")]
mod testkit;

pub use l1::{CacheError, TtlCache, TtlCacheConfig};
pub use l2::{
    create_redis_ttl_cache, CacheResult, RedisCacheOptions, RedisTtlCache, NOT_FOUND_MARKER,
};
pub use store::{
    create_redis_client, create_redis_health, create_redis_store, parse_redis_config, RedisClient,
    RedisConfig, RedisHealth, RedisHealthClient, RedisHealthOptions, RedisMode, RedisStore,
    StoreError,
};
#[cfg(feature = "testkit")]
pub use testkit::InMemoryStore;
