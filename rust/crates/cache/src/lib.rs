//! Rail Saarthi — `tt-cache` crate.
//!
//! Seam: Cache::get/put(key, ttl) hiding L1 TTL single-flight + L2 Redis + gzip.
//!
//! Deep module: keep the public surface in this file small and hide the
//! implementation in private submodules. The interface here is the test surface.
