//! Test-only in-memory `RedisStore` (behind the `testkit` feature), so
//! downstream crates (the api-server route tests) can exercise the L2 cache
//! hermetically without a Redis server or the `real-client` socket code.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use crate::{RedisStore, StoreError};

/// A scriptable in-memory `RedisStore`: settable availability, a raw
/// `key -> (value, ttl)` map, and a log of every write it performs.
pub struct InMemoryStore {
    available: AtomicBool,
    data: Mutex<HashMap<String, (Vec<u8>, u64)>>,
    writes: Mutex<Vec<(String, Vec<u8>, u64)>>,
}

impl InMemoryStore {
    pub fn new() -> Arc<InMemoryStore> {
        Arc::new(InMemoryStore {
            available: AtomicBool::new(true),
            data: Mutex::new(HashMap::new()),
            writes: Mutex::new(Vec::new()),
        })
    }

    /// Toggles `is_available()` (the store stays up; commands still succeed).
    pub fn set_available(&self, available: bool) {
        self.available.store(available, Ordering::Relaxed);
    }

    /// Inserts a raw value directly, bypassing the cache (network shorthand).
    pub fn seed(&self, key: &str, value: Vec<u8>) {
        self.data
            .lock()
            .unwrap()
            .insert(key.to_string(), (value, 60));
    }

    /// Every successful `set`, as `(key, value, ttl_seconds)`.
    pub fn writes(&self) -> Vec<(String, Vec<u8>, u64)> {
        self.writes.lock().unwrap().clone()
    }
}

#[async_trait]
impl RedisStore for InMemoryStore {
    fn is_available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }

    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .data
            .lock()
            .unwrap()
            .get(key)
            .map(|(value, _)| value.clone()))
    }

    async fn set(&self, key: &str, value: Vec<u8>, ttl_seconds: u64) -> Result<(), StoreError> {
        self.data
            .lock()
            .unwrap()
            .insert(key.to_string(), (value.clone(), ttl_seconds));
        self.writes
            .lock()
            .unwrap()
            .push((key.to_string(), value, ttl_seconds));
        Ok(())
    }
}
