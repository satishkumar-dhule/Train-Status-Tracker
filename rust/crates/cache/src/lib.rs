//! Rail Saarthi — `tt-cache` crate.
//!
//! Seam: `Cache::get/put(key, ttl)` hiding L1 TTL single-flight + L2 Redis + gzip.
//! Ports of `lib/ttl-cache.ts`, `lib/redis-cache.ts`, and `lib/redis-client.ts`.
//!
//! Deep module: the public surface below is the whole contract — two caches
//! and the store seam behind the L2 layer. Implementation lives in private
//! submodules, tested through this surface (and the `Store` seam) only.
//!
//! Public surface:
//!
//! - [`TtlCache`] / [`create_ttl_cache`] — the L1 in-memory TTL cache with
//!   single-flight `get_or_set` (port of `createTtlCache`).
//! - [`RedisTtlCache`] / [`create_redis_ttl_cache`] — the L2 fail-open Redis
//!   TTL cache with gzip and jitter (port of `createRedisTtlCache`).
//! - [`Store`] — the minimal async key-value seam (port of the `RedisStore`
//!   interface in `redis-client.ts`), plus [`parse_redis_config`] /
//!   [`RedisConfig`] for the disabled/scheme/mode/env rules of
//!   `parseRedisConfig`.
//!
//! The production store (behind the `real-client` feature) wraps the `redis`
//! crate with a health controller mirroring `createRedisHealth` and
//! `createRedisStore`.

mod l1;
mod l2;
mod store;

pub use l1::{create_ttl_cache, TtlCache};
pub use l2::{create_redis_ttl_cache, CacheResult, RedisCacheOptions, RedisTtlCache};
pub use store::{parse_redis_config, RedisConfig, RedisMode, Store};