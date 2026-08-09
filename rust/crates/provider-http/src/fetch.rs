//! Shared upstream fetch + error classification for every provider adapter,
//! ported from `fetchProviderStatus` in `providers/http.ts` (the telemetry
//! leg is a Rust-server concern and lives at the orchestrator seam instead).
//!
//! Providers only supply the request and a `map` closure; calling upstreams —
//! timeouts, redirect cap, byte cap, and the transport-error taxonomy — is
//! classified here once (DRY):
//!
//! | Transport failure | Provider message |
//! |---|---|
//! | timeout / aborted / network / redirect limit / other | `Network error reaching {provider}` |
//! | non-2xx status | `{provider} returned status {status}` |
//! | oversized body | `{provider} response too large` |
//! | body parse/decode failure | `Invalid response body from {provider}` |

use tt_provider_core::ProviderError;

use crate::transport::{HttpTransport, Request, Response, TransportError};

/// Fetch a provider endpoint and parse the 2xx body as JSON, classifying
/// failures into [`ProviderError::Upstream`] exactly like `fetchProviderStatus`
/// with `responseType: "json"`.
pub async fn fetch_provider_json(
    transport: &dyn HttpTransport,
    provider: &str,
    request: Request,
) -> Result<serde_json::Value, ProviderError> {
    let response = execute(transport, provider, request).await?;
    response.json().map_err(|cause| {
        ProviderError::upstream_with_cause(
            provider,
            format!("Invalid response body from {provider}"),
            cause,
        )
    })
}

/// Fetch a provider endpoint and decode the 2xx body as UTF-8 text (HTML
/// scrapers), classifying failures like `fetchProviderStatus` with
/// `responseType: "text"`.
pub async fn fetch_provider_text(
    transport: &dyn HttpTransport,
    provider: &str,
    request: Request,
) -> Result<String, ProviderError> {
    let response = execute(transport, provider, request).await?;
    response.text().map_err(|cause| {
        ProviderError::upstream_with_cause(
            provider,
            format!("Invalid response body from {provider}"),
            cause,
        )
    })
}

/// The shared transport leg: execute the request and translate every
/// [`TransportError`] into the exact `TrainStatusUpstreamError` message the
/// TypeScript server produces.
async fn execute(
    transport: &dyn HttpTransport,
    provider: &str,
    request: Request,
) -> Result<Response, ProviderError> {
    transport.execute(request).await.map_err(|err| {
        let message = match &err {
            TransportError::Timeout { .. }
            | TransportError::Aborted
            | TransportError::Network { .. }
            | TransportError::RedirectLimit { .. }
            | TransportError::Other { .. } => {
                format!("Network error reaching {provider}")
            }
            TransportError::Status { status } => format!("{provider} returned status {status}"),
            TransportError::Oversized { .. } => format!("{provider} response too large"),
        };
        ProviderError::upstream_with_cause(provider, message, err)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MockTransport;
    use std::sync::Arc;

    /// Build a mock with the given routes, wrapped in an `Arc` for the
    /// `&dyn HttpTransport` seam.
    fn mock_with(routes: impl FnOnce(&mut MockTransport)) -> Arc<MockTransport> {
        let mut transport = MockTransport::new();
        routes(&mut transport);
        Arc::new(transport)
    }

    #[test]
    fn non_2xx_status_is_classified_with_status() {
        let transport = mock_with(|mock| {
            mock.push("/status", 502, b"boom".to_vec());
        });
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_provider_json(
                transport.as_ref(),
                "goibibo",
                Request::get("https://upstream.example/status"),
            ))
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "upstream error from goibibo: goibibo returned status 502"
        );
    }

    #[test]
    fn oversized_body_is_classified_as_too_large() {
        let transport = mock_with(|mock| {
            mock.push(
                "/status",
                200,
                vec![b'x'; crate::DEFAULT_MAX_RESPONSE_BYTES + 1],
            );
        });
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_provider_json(
                transport.as_ref(),
                "goibibo",
                Request::get("https://upstream.example/status"),
            ))
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "upstream error from goibibo: goibibo response too large"
        );
    }

    #[test]
    fn unmatched_requests_become_network_error() {
        let transport = mock_with(|_| {});
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_provider_json(
                transport.as_ref(),
                "goibibo",
                Request::get("https://upstream.example/unmatched"),
            ))
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "upstream error from goibibo: Network error reaching goibibo"
        );
    }

    #[test]
    fn unparsable_json_body_is_invalid_response() {
        let transport = mock_with(|mock| {
            mock.push("/status", 200, b"<html>oops</html>".to_vec());
        });
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_provider_json(
                transport.as_ref(),
                "goibibo",
                Request::get("https://upstream.example/status"),
            ))
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "upstream error from goibibo: Invalid response body from goibibo"
        );
    }

    #[test]
    fn text_fetch_returns_body_and_reports_decode_failures() {
        let transport = mock_with(|mock| {
            mock.push("/page", 200, b"<html>hi</html>".to_vec());
        });
        let body = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_provider_text(
                transport.as_ref(),
                "easemytrip",
                Request::get("https://upstream.example/page"),
            ))
            .unwrap();
        assert_eq!(body, "<html>hi</html>");

        let transport = mock_with(|mock| {
            mock.push("/page", 200, vec![0xff, 0xfe, 0xfd]);
        });
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_provider_text(
                transport.as_ref(),
                "easemytrip",
                Request::get("https://upstream.example/page"),
            ))
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "upstream error from easemytrip: Invalid response body from easemytrip"
        );
    }
}
