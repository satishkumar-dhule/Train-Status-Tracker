//! The injectable HTTP seam every provider adapter and test shares.
//!
//! This module is the whole *public* surface of the transport: a tiny
//! [`Request`]/[`Response`] pair, a classified [`TransportError`], and the
//! [`HttpTransport`] trait that keeps reqwest and the network behind it.
//! Providers depend on [`HttpTransport`] — never on reqwest — so tests can
//! substitute [`crate::MockTransport`] and stay hermetic.

use std::fmt;
use std::time::Duration;

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use tt_provider_core::AbortSignal;

/// Default per-request timeout. Mirrors `DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000`
/// in `providers/http.ts`.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_millis(10_000);

/// Default cap on response body bytes. Mirrors
/// `DEFAULT_UPSTREAM_MAX_BYTES = 2 * 1024 * 1024` in `providers/http.ts`.
pub const DEFAULT_MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

/// Default maximum number of redirects to follow before failing. The TS `fetch`
/// default is 20; the Rust seam deliberately tightens this to 3.
pub const DEFAULT_MAX_REDIRECTS: usize = 3;

/// An HTTP method a provider adapter can use. Mirrors the
/// `method?: "GET" | "POST"` union in `ProviderRequestSpec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Method {
    Get,
    Post,
}

impl Method {
    /// The wire representation, e.g. `"GET"`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
        }
    }
}

impl AsRef<str> for Method {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for Method {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A request built by a provider adapter and handed to [`HttpTransport::execute`].
///
/// Build it with the constructor/chain helpers rather than a struct literal —
/// the fields stay public for inspection (e.g. `MockTransport::requests()`),
/// but the helpers keep construction ergonomic.
#[derive(Debug, Clone)]
pub struct Request {
    /// HTTP method.
    pub method: Method,
    /// Absolute URL, e.g. `https://api.example.com/v1/status`.
    pub url: String,
    /// Header name/value pairs, in request order.
    pub headers: Vec<(String, String)>,
    /// Optional request body bytes.
    pub body: Option<Vec<u8>>,
    /// Per-request timeout. `None` falls back to [`DEFAULT_TIMEOUT`].
    pub timeout: Option<Duration>,
    /// Optional cancellation signal; honored on in-flight requests.
    pub abort: Option<AbortSignal>,
}

impl Request {
    /// Create a request with a method and URL.
    pub fn new(method: Method, url: impl Into<String>) -> Self {
        Self {
            method,
            url: url.into(),
            headers: Vec::new(),
            body: None,
            timeout: None,
            abort: None,
        }
    }

    /// Create a `GET` request.
    pub fn get(url: impl Into<String>) -> Self {
        Self::new(Method::Get, url)
    }

    /// Create a `POST` request.
    pub fn post(url: impl Into<String>) -> Self {
        Self::new(Method::Post, url)
    }

    /// Append a header.
    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    /// Set the request body bytes.
    pub fn body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.body = Some(body.into());
        self
    }

    /// Set the body as JSON, adding a `content-type: application/json` header.
    pub fn json_body(mut self, value: &impl serde::Serialize) -> Result<Self, serde_json::Error> {
        self.body = Some(serde_json::to_vec(value)?);
        self.headers
            .push(("content-type".to_string(), "application/json".to_string()));
        Ok(self)
    }

    /// Set a per-request timeout (overrides [`DEFAULT_TIMEOUT`]).
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Attach an external abort signal; the in-flight request is cancelled when
    /// it fires.
    pub fn abort(mut self, signal: AbortSignal) -> Self {
        self.abort = Some(signal);
        self
    }

    /// Look up the last header value, case-insensitively.
    pub fn header_value(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .rev()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// A response returned by [`HttpTransport::execute`]. On success the body is
/// fully buffered and the status is a 2xx — non-2xx statuses surface as
/// [`TransportError::Status`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    /// Final HTTP status code (2xx on success).
    pub status: u16,
    /// Header name/value pairs (names lower-cased).
    pub headers: Vec<(String, String)>,
    /// Fully buffered response body bytes.
    pub body: Vec<u8>,
}

impl Response {
    /// Construct a response from a status and body.
    pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    /// The HTTP status code.
    pub fn status(&self) -> u16 {
        self.status
    }

    /// Look up a header value, case-insensitively.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// The raw response body bytes.
    pub fn body(&self) -> &[u8] {
        &self.body
    }

    /// Consume the response, returning the body bytes.
    pub fn into_body(self) -> Vec<u8> {
        self.body
    }

    /// Parse the body as JSON. The error is handed to the adapter, which
    /// classifies it (mirrors the TS `parse_error` outcome).
    pub fn json<T: DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_slice(&self.body)
    }

    /// Decode the body as UTF-8 text.
    pub fn text(&self) -> Result<String, std::string::FromUtf8Error> {
        String::from_utf8(self.body.clone())
    }
}

/// Classified transport failures, mirroring the `UpstreamOutcome` taxonomy in
/// `providers/http.ts` (timeout / abort / network_error / http_error /
/// too_large), plus redirect-limit which the TS inherits from fetch.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    /// The request exceeded its timeout (default [`DEFAULT_TIMEOUT`]).
    #[error("request timed out after {timeout:?}")]
    Timeout {
        /// The effective timeout that expired.
        timeout: Duration,
    },

    /// The request was cancelled by an [`AbortSignal`].
    #[error("request aborted")]
    Aborted,

    /// A network-level failure: DNS, connect, TLS, or a dropped connection.
    #[error("network error: {message}")]
    Network {
        /// Human-readable description of the underlying failure.
        message: String,
    },

    /// The redirect policy was exhausted.
    #[error("too many redirects (max {max})")]
    RedirectLimit {
        /// The configured redirect cap.
        max: usize,
    },

    /// The response body exceeded the byte cap.
    #[error("response too large: limit {limit} bytes, received {received}")]
    Oversized {
        /// The configured cap.
        limit: usize,
        /// Content-length declared by the upstream, or bytes read so far.
        received: usize,
    },

    /// The upstream returned a non-2xx status.
    #[error("upstream returned status {status}")]
    Status {
        /// The non-2xx HTTP status code.
        status: u16,
    },

    /// A local failure that is not an upstream verdict (bad URL, bad header).
    #[error("transport error: {message}")]
    Other {
        /// Human-readable description of the failure.
        message: String,
    },
}

/// The injectable HTTP seam. Providers and tests share one client through this
/// trait; nothing else in the codebase touches reqwest or the network directly.
#[async_trait]
pub trait HttpTransport: Send + Sync {
    /// Execute a request and return a fully-buffered 2xx response, classifying
    /// failures into [`TransportError`] variants.
    async fn execute(&self, request: Request) -> Result<Response, TransportError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_builder_is_ergonomic() {
        let req = Request::post("https://example.com/status")
            .header("X-Api-Key", "secret")
            .body(vec![1, 2, 3])
            .timeout(Duration::from_secs(1));

        assert_eq!(req.method, Method::Post);
        assert_eq!(req.url, "https://example.com/status");
        assert_eq!(req.header_value("x-api-key"), Some("secret"));
        assert_eq!(req.body.as_deref(), Some(&[1, 2, 3][..]));
        assert_eq!(req.timeout, Some(Duration::from_secs(1)));
        assert!(req.abort.is_none());
    }

    #[test]
    fn json_body_serializes_and_sets_content_type() {
        let req = Request::post("https://example.com/status")
            .json_body(&serde_json::json!({ "train": "22943" }))
            .expect("serialize");
        assert_eq!(req.header_value("content-type"), Some("application/json"));
        let parsed: serde_json::Value =
            serde_json::from_slice(req.body.as_deref().expect("body set")).expect("parse");
        assert_eq!(parsed, serde_json::json!({ "train": "22943" }));
    }

    #[test]
    fn response_accessors_and_parsing() {
        let resp = Response {
            status: 200,
            headers: vec![("content-type".to_string(), "application/json".to_string())],
            body: br#"{"ok":true}"#.to_vec(),
        };
        assert_eq!(resp.status(), 200);
        assert_eq!(resp.header("Content-Type"), Some("application/json"));
        assert_eq!(resp.json::<serde_json::Value>().unwrap()["ok"], true);
        assert_eq!(resp.text().unwrap(), r#"{"ok":true}"#);
    }

    #[test]
    fn response_json_reports_parse_errors() {
        let resp = Response::new(200, b"<html>oops</html>".to_vec());
        assert!(resp.json::<serde_json::Value>().is_err());
    }

    #[test]
    fn constants_match_the_typescript_originals() {
        assert_eq!(DEFAULT_TIMEOUT, Duration::from_millis(10_000));
        assert_eq!(DEFAULT_MAX_RESPONSE_BYTES, 2 * 1024 * 1024);
        assert_eq!(DEFAULT_MAX_REDIRECTS, 3);
    }

    #[test]
    fn method_stringifies_like_http() {
        assert_eq!(Method::Get.as_str(), "GET");
        assert_eq!(Method::Post.to_string(), "POST");
        assert_eq!(Method::Get.as_ref(), "GET");
    }
}
