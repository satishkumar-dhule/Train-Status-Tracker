//! JSON subscriber setup and the small event helpers.

use crate::Level;

/// Lifetime marker for the global tracing subscriber installed by [`init`].
///
/// It performs no work on drop (a `set_global_default` subscriber cannot be
/// unset), but must be held for the app's lifetime so the structured JSON
/// logging stays configured.
#[derive(Debug)]
pub struct LogGuard {
    _private: (),
}

/// Installs a JSON-logging global subscriber at the given minimum [`Level`].
///
/// Uses `tracing::subscriber::set_global_default`, so it applies to every
/// thread of the process. Panics if a global default was already installed;
/// call exactly once, at startup, and keep the returned [`LogGuard`] alive.
pub fn init(level: Level) -> LogGuard {
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_max_level(level.as_level_filter())
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("a tracing global default subscriber is already installed");
    LogGuard { _private: () }
}

/// The common `logger.warn({ provider, trainNumber }, msg)` shape from the
/// TypeScript server, as a small function. Optional fields are omitted from the
/// JSON record rather than emitted as `null`.
pub fn warn_event(provider: Option<&str>, train: Option<&str>, message: &str) {
    match (provider, train) {
        (Some(provider), Some(train)) => {
            tracing::warn!(provider = %provider, trainNumber = %train, "{message}");
        }
        (Some(provider), None) => {
            tracing::warn!(provider = %provider, "{message}");
        }
        (None, Some(train)) => {
            tracing::warn!(trainNumber = %train, "{message}");
        }
        (None, None) => {
            tracing::warn!("{message}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Only this test installs the global subscriber: `set_global_default` can
    /// be called once per process.
    #[test]
    fn init_installs_a_json_global_subscriber() {
        let _guard = init(Level::Info);

        tracing::info!("structured json");
        warn_event(Some("paytm"), Some("12345"), "upstream slow");
        warn_event(Some("paytm"), None, "upstream slow");
        warn_event(None, Some("12345"), "upstream slow");
        warn_event(None, None, "generic warning");
        tracing::debug!("filtered out at info level");
    }
}
