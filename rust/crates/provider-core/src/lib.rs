//! Rail Saarthi — `tt-provider-core` crate.
//!
//! Seam: the shared train-status provider contract every upstream adapter
//! implements. Mirrors `providers/types.ts` + `providers/errors.ts`:
//!
//! - [`TrainStatusProvider`] — the trait all 6 adapters implement.
//! - [`ProviderError`] — the provider-agnostic error taxonomy (not-found vs
//!   transient upstream error vs adapter program error).
//! - [`KnownTrain`], [`ProviderFetchOptions`], [`AbortSignal`] — the request
//!   context passed into [`TrainStatusProvider::fetch_train_status`].
//!
//! Deep module: this file is the whole public surface. Adapters stay behind it;
//! consumers reason about failure through [`ProviderError`] without importing
//! provider-specific types, exactly like the TS `errors.ts`.

use std::error::Error;
use std::sync::Arc;

use async_trait::async_trait;
use tt_mapper::{KnownTrain, MappedStatus};

/// Abort token carried on provider requests (mirrors `AbortSignal` in TS).
///
/// A provider builds one from caller-provided options; the transport awaits
/// [`AbortSignal::cancelled`] while a request is in flight so an external
/// cancellation can cut it short. Backed by a `tokio` watch channel so the
/// abort flag is observed race-free.
#[derive(Clone, Debug)]
pub struct AbortSignal {
    inner: Arc<AbortInner>,
}

#[derive(Debug)]
struct AbortInner {
    tx: tokio::sync::watch::Sender<bool>,
}

impl Default for AbortSignal {
    fn default() -> Self {
        Self::new()
    }
}

impl AbortSignal {
    /// Create a fresh, non-aborted signal.
    pub fn new() -> Self {
        let (tx, _) = tokio::sync::watch::channel(false);
        Self {
            inner: Arc::new(AbortInner { tx }),
        }
    }

    /// Request cancellation of any in-flight request carrying this signal.
    pub fn abort(&self) {
        let _ = self.inner.tx.send(true);
    }

    /// Whether [`AbortSignal::abort`] has been called.
    pub fn is_aborted(&self) -> bool {
        *self.inner.tx.borrow()
    }

    /// Resolves once the signal is aborted. Returns immediately when already
    /// aborted.
    pub async fn cancelled(&self) {
        let mut rx = self.inner.tx.subscribe();
        if *rx.borrow_and_update() {
            return;
        }
        while rx.changed().await.is_ok() {
            if *rx.borrow_and_update() {
                return;
            }
        }
    }
}

/// Transport options passed through to providers. Mirrors the TS
/// [`ProviderFetchOptions`](https://github.com/anomalyco/opencode) shape:
/// `fetchImpl` is replaced by the injected [`crate::HttpTransport`]-style
/// dependency, so the only per-request option is an external abort signal.
#[derive(Debug, Clone, Default)]
pub struct ProviderFetchOptions {
    /// External cancellation signal, passed through to the upstream request.
    pub abort: Option<AbortSignal>,
}

/// Context needed to render a human-readable train name on unknown trains.
/// Defined in `tt-mapper` (next to the payloads it is threaded through) and
/// re-exported here so the provider seam exposes it under one name.
pub use tt_mapper::KnownTrain as KnownTrain;

/// Provider-agnostic error taxonomy for train status upstreams.
///
/// Mirrors `providers/errors.ts`: the orchestrator and routes reason about
/// failure (not-found vs transient upstream error) without importing
/// provider-specific types. Every adapter wraps its own quirks into one of
/// these.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    /// The provider positively confirmed the train does not exist / has no
    /// data. Never used for ambiguous or transient failures (ZTA).
    #[error("train not found (provider: {provider})")]
    NotFound { provider: String },

    /// A transient upstream failure: network error, bad status, parse error,
    /// timeout, aborted request, or a response the provider flagged as
    /// errored (as opposed to confirmed-not-found).
    #[error("upstream error from {provider}: {message}")]
    Upstream {
        provider: String,
        message: String,
        #[source]
        cause: Option<Box<dyn Error + Send + Sync>>,
    },

    /// A bug in the adapter itself (unreachable variant, internal invariant
    /// violated, unexpected local error). Not an upstream verdict.
    #[error("program error: {0}")]
    Program(String),
}

impl ProviderError {
    /// `new TrainStatusNotFoundError(provider, ...)`.
    pub fn not_found(provider: impl Into<String>) -> Self {
        Self::NotFound {
            provider: provider.into(),
        }
    }

    /// `new TrainStatusUpstreamError(provider, message)`.
    pub fn upstream(provider: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Upstream {
            provider: provider.into(),
            message: message.into(),
            cause: None,
        }
    }

    /// `new TrainStatusUpstreamError(provider, message, { cause })`.
    pub fn upstream_with_cause(
        provider: impl Into<String>,
        message: impl Into<String>,
        cause: impl Into<Box<dyn Error + Send + Sync>>,
    ) -> Self {
        Self::Upstream {
            provider: provider.into(),
            message: message.into(),
            cause: Some(cause.into()),
        }
    }

    /// Adapter-side program error.
    pub fn program(message: impl Into<String>) -> Self {
        Self::Program(message.into())
    }
}

/// A train status upstream. Each adapter is a "deep module": it owns its
/// endpoint, request encoding, authentication, date format and payload
/// parsing, and only exposes this small surface.
#[async_trait]
pub trait TrainStatusProvider: Send + Sync {
    /// Adapter name, e.g. `"paytm"`. Matches the `providers/registry.ts` keys.
    fn name(&self) -> &str;

    /// Whether this provider may be used in the current environment.
    fn enabled(&self) -> bool;

    /// Fetch + normalize the running status for `train_number` departing on
    /// `departure_date` (`YYYYMMDD`).
    ///
    /// Mirrors `TrainStatusProvider.fetchTrainStatus(trainNumber,
    /// departureDate, options, knownTrain)`: returns a normalized
    /// [`MappedStatus`], or a [`ProviderError`] classifying the failure.
    async fn fetch_train_status(
        &self,
        train_number: &str,
        departure_date: &str,
        options: &ProviderFetchOptions,
        known_train: Option<&KnownTrain>,
    ) -> Result<MappedStatus, ProviderError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeProvider {
        name: &'static str,
        enabled: bool,
    }

    #[async_trait]
    impl TrainStatusProvider for FakeProvider {
        fn name(&self) -> &str {
            self.name
        }
        fn enabled(&self) -> bool {
            self.enabled
        }
        async fn fetch_train_status(
            &self,
            train_number: &str,
            departure_date: &str,
            _options: &ProviderFetchOptions,
            _known_train: Option<&KnownTrain>,
        ) -> Result<MappedStatus, ProviderError> {
            Err(ProviderError::not_found(self.name).into())?;
            let _ = (train_number, departure_date);
            Ok(MappedStatus {
                train_number: String::new(),
                train_name: String::new(),
                departure_date: String::new(),
                source_station_code: String::new(),
                source_station_name: String::new(),
                destination_station_code: String::new(),
                destination_station_name: String::new(),
                current_station_code: None,
                current_station_name: None,
                current_delay_minutes: None,
                status_message: None,
                last_updated: None,
                stations: vec![],
            })
        }
    }

    #[test]
    fn error_constructors_and_messages() {
        let not_found = ProviderError::not_found("paytm");
        assert!(matches!(
            not_found,
            ProviderError::NotFound { provider } if provider == "paytm"
        ));
        assert!(not_found.to_string().contains("paytm"));

        let upstream = ProviderError::upstream("paytm", "boom");
        assert!(matches!(
            upstream,
            ProviderError::Upstream { provider, message, cause } if provider == "paytm" && message == "boom" && cause.is_none()
        ));

        let caused = ProviderError::upstream_with_cause(
            "paytm",
            "boom",
            std::io::Error::new(std::io::ErrorKind::Other, "root"),
        );
        assert!(matches!(&caused, ProviderError::Upstream { cause: Some(_), .. }));

        let program = ProviderError::program("bug");
        assert!(matches!(program, ProviderError::Program(_)));
    }

    #[tokio::test]
    async fn abort_signal_aborts_and_resolves_cancelled() {
        let signal = AbortSignal::new();
        assert!(!signal.is_aborted());

        let waiter = signal.clone();
        let handle = tokio::spawn(async move { waiter.cancelled().await; });

        signal.abort();
        assert!(signal.is_aborted());

        tokio::time::timeout(std::time::Duration::from_secs(1), handle)
            .await
            .expect("cancelled() must resolve after abort")
            .unwrap();
    }

    #[tokio::test]
    async fn cancelled_returns_immediately_when_already_aborted() {
        let signal = AbortSignal::new();
        signal.abort();
        tokio::time::timeout(std::time::Duration::from_secs(1), signal.cancelled())
            .await
            .expect("cancelled() on an aborted signal must resolve immediately");
    }

    #[test]
    fn provider_fetch_options_defaults_to_no_abort() {
        let options = ProviderFetchOptions::default();
        assert!(options.abort.is_none());
    }
}
