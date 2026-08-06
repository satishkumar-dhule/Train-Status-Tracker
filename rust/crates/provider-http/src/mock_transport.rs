//! A canned-response [`HttpTransport`] for hermetic provider tests.
//!
//! Providers and their test suites share the same [`HttpTransport`] seam, so
//! `MockTransport` mirrors [`crate::ReqwestTransport`]'s classification exactly:
//! non-2xx statuses surface as [`TransportError::Status`], bodies over the byte
//! cap as [`TransportError::Oversized`], and an aborted signal as
//! [`TransportError::Aborted`]. It never touches the network.
//!
//! Compiled for this crate's own tests and for provider crates that enable the
//! `testkit` feature.

use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;

use crate::transport::{
    HttpTransport, Request, Response, TransportError, DEFAULT_MAX_RESPONSE_BYTES,
};

/// A canned response served by [`MockTransport`].
struct Route {
    /// Request URL path this route matches (`None` = catch-all default).
    path: Option<String>,
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    delay: Option<Duration>,
}

/// A scripted HTTP transport: responses are pushed per path (with an optional
/// catch-all), matched by the request URL's path, and every executed request is
/// recorded for assertion.
pub struct MockTransport {
    routes: Vec<Route>,
    default: Option<Route>,
    max_response_bytes: usize,
    log: Mutex<Vec<Request>>,
}

impl Default for MockTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl MockTransport {
    /// Create an empty transport with the default byte cap
    /// ([`DEFAULT_MAX_RESPONSE_BYTES`]). Every request must match a pushed
    /// route or the catch-all default; unmatched requests fail with
    /// [`TransportError::Other`].
    pub fn new() -> Self {
        Self {
            routes: Vec::new(),
            default: None,
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
            log: Mutex::new(Vec::new()),
        }
    }

    /// Override the response byte cap (mirrors
    /// [`ReqwestTransport::with_max_response_bytes`]).
    pub fn with_max_response_bytes(mut self, max: usize) -> Self {
        self.max_response_bytes = max;
        self
    }

    /// Serve `status`/`body` for any request whose URL path equals `path`.
    /// Earlier pushes win over later ones for the same path.
    pub fn push(
        &mut self,
        path: impl Into<String>,
        status: u16,
        body: impl Into<Vec<u8>>,
    ) -> &mut Self {
        self.routes.push(Route {
            path: Some(path.into()),
            status,
            headers: Vec::new(),
            body: body.into(),
            delay: None,
        });
        self
    }

    /// Serve `status`/`body` after `delay` for any request whose URL path
    /// equals `path`. `delay` lets tests exercise mid-flight aborts: the abort
    /// branch of the `select!` in [`HttpTransport::execute`] wins while the
    /// route is still sleeping.
    pub fn push_delayed(
        &mut self,
        path: impl Into<String>,
        delay: Duration,
        status: u16,
        body: impl Into<Vec<u8>>,
    ) -> &mut Self {
        self.routes.push(Route {
            path: Some(path.into()),
            status,
            headers: Vec::new(),
            body: body.into(),
            delay: Some(delay),
        });
        self
    }

    /// Serve a JSON response (with a `content-type: application/json` header)
    /// for any request whose URL path equals `path`.
    pub fn push_json(&mut self, path: impl Into<String>, value: &serde_json::Value) -> &mut Self {
        self.push(path, 200, serde_json::to_vec(value).expect("json is valid"))
            .with_header("content-type", "application/json")
    }

    /// Serve `status`/`body` for any request not matched by a pushed route.
    pub fn respond(&mut self, status: u16, body: impl Into<Vec<u8>>) -> &mut Self {
        self.default = Some(Route {
            path: None,
            status,
            headers: Vec::new(),
            body: body.into(),
            delay: None,
        });
        self
    }

    /// Serve a JSON catch-all for any unmatched request.
    pub fn respond_json(&mut self, value: &serde_json::Value) -> &mut Self {
        self.respond(200, serde_json::to_vec(value).expect("json is valid"))
            .with_header("content-type", "application/json")
    }

    /// Add a header to the most recently pushed route or catch-all default.
    pub fn with_header(&mut self, name: impl Into<String>, value: impl Into<String>) -> &mut Self {
        let target = self
            .routes
            .last_mut()
            .unwrap_or_else(|| self.default.as_mut().expect("no response pushed yet"));
        target
            .headers
            .push((name.into().to_ascii_lowercase(), value.into()));
        self
    }

    /// All requests executed so far, in order (useful for asserting the exact
    /// method, URL, headers and body a provider sent).
    pub fn requests(&self) -> Vec<Request> {
        self.log.lock().expect("mock log not poisoned").clone()
    }

    /// Clear the request log.
    pub fn clear_requests(&self) {
        self.log.lock().expect("mock log not poisoned").clear();
    }

    async fn execute_route(&self, request: &Request) -> Result<Response, TransportError> {
        let route = self.match_route(request)?;
        let status = route.status;

        // Mirror ReqwestTransport's order: status before byte cap.
        if !(200..300).contains(&status) {
            return Err(TransportError::Status { status });
        }
        if route.body.len() > self.max_response_bytes {
            return Err(TransportError::Oversized {
                limit: self.max_response_bytes,
                received: route.body.len(),
            });
        }
        if let Some(delay) = route.delay {
            tokio::time::sleep(delay).await;
        }

        Ok(Response {
            status,
            headers: route.headers.clone(),
            body: route.body.clone(),
        })
    }

    fn match_route(&self, request: &Request) -> Result<&Route, TransportError> {
        let path = url_path(&request.url);
        if let Some(route) = self
            .routes
            .iter()
            .find(|route| route.path.as_deref() == Some(path))
        {
            return Ok(route);
        }
        if let Some(default) = &self.default {
            return Ok(default);
        }
        Err(TransportError::Other {
            message: format!(
                "no mock response for {} {path} (push one with \
                 `MockTransport::push`, or set a catch-all with `respond`)",
                request.method
            ),
        })
    }
}

#[async_trait]
impl HttpTransport for MockTransport {
    async fn execute(&self, request: Request) -> Result<Response, TransportError> {
        self.log
            .lock()
            .expect("mock log not poisoned")
            .push(request.clone());

        let abort = request.abort.clone();

        if let Some(signal) = &abort {
            if signal.is_aborted() {
                return Err(TransportError::Aborted);
            }
        }

        match abort {
            Some(signal) => tokio::select! {
                result = self.execute_route(&request) => result,
                _ = signal.cancelled() => Err(TransportError::Aborted),
            },
            None => self.execute_route(&request).await,
        }
    }
}

/// Extract the path component of a URL (everything after the authority, before
/// the query string), e.g. `https://api.example.com/v1/status?q=1` → `/v1/status`.
fn url_path(url: &str) -> &str {
    let without_query = url.split('?').next().unwrap_or(url);
    match without_query.find("://") {
        Some(scheme_end) => {
            let rest = &without_query[scheme_end + 3..];
            match rest.find('/') {
                Some(slash) => &rest[slash..],
                None => "/",
            }
        }
        None => {
            let slash = without_query.find('/').unwrap_or(0);
            if slash == 0 && !without_query.starts_with('/') {
                "/"
            } else {
                &without_query[slash..]
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::transport::Method;
    use tt_provider_core::AbortSignal;

    #[tokio::test]
    async fn serves_2xx_responses_and_logs_requests() {
        let mut transport = MockTransport::new();
        transport.push_json("/status", &serde_json::json!({ "ok": true }));

        let response = transport
            .execute(Request::get("https://example.com/status"))
            .await
            .expect("success");

        assert_eq!(response.status(), 200);
        assert_eq!(response.json::<serde_json::Value>().unwrap()["ok"], true);

        let logged = transport.requests();
        assert_eq!(logged.len(), 1);
        assert_eq!(logged[0].url, "https://example.com/status");
        assert_eq!(logged[0].method, Method::Get);
    }

    #[tokio::test]
    async fn matches_routes_by_path_with_a_catch_all_fallback() {
        let mut transport = MockTransport::new();
        transport.push("/specific", 200, "specific");
        transport.respond(200, "default");

        let response = transport
            .execute(Request::get("https://example.com/specific"))
            .await
            .expect("specific");
        assert_eq!(response.text().unwrap(), "specific");

        let response = transport
            .execute(Request::get("https://example.com/other"))
            .await
            .expect("default");
        assert_eq!(response.text().unwrap(), "default");
    }

    #[tokio::test]
    async fn unmatched_requests_fail_with_a_helpful_error() {
        let transport = MockTransport::new();
        let err = transport
            .execute(Request::get("https://example.com/nothing"))
            .await
            .expect_err("must fail");
        assert!(matches!(err, TransportError::Other { .. }));
        assert!(err.to_string().contains("no mock response"));
    }

    #[tokio::test]
    async fn classifies_non_2xx_statuses_like_the_real_transport() {
        let mut transport = MockTransport::new();
        transport.push("/not-found", 404, "nope");
        transport.push("/server-error", 500, "boom");

        let err = transport
            .execute(Request::get("https://example.com/not-found"))
            .await
            .expect_err("404 must fail");
        assert!(matches!(err, TransportError::Status { status: 404 }));

        let err = transport
            .execute(Request::get("https://example.com/server-error"))
            .await
            .expect_err("500 must fail");
        assert!(matches!(err, TransportError::Status { status: 500 }));
    }

    #[tokio::test]
    async fn rejects_oversized_bodies() {
        let mut transport = MockTransport::new().with_max_response_bytes(16);
        transport.push("/big", 200, vec![b'x'; 1024]);

        let err = transport
            .execute(Request::get("https://example.com/big"))
            .await
            .expect_err("must be oversized");
        assert!(matches!(
            err,
            TransportError::Oversized {
                limit: 16,
                received,
            } if received == 1024
        ));
    }

    #[tokio::test]
    async fn aborts_when_the_signal_is_already_fired() {
        let mut transport = MockTransport::new();
        transport.respond(200, "ok");
        let signal = AbortSignal::new();

        // Hold a live receiver on the signal's watch channel so `abort()`
        // stores the flag (tokio `watch::Sender::send` drops the value when no
        // receiver exists; `AbortSignal::new()` drops its receiver immediately).
        // This keeps `is_aborted()` truthful for the fast-path under test.
        let waiter = signal.clone();
        let _guard = tokio::spawn(async move { waiter.cancelled().await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        signal.abort();

        let err = transport
            .execute(Request::get("https://example.com/now").abort(signal))
            .await
            .expect_err("must abort");
        assert!(matches!(err, TransportError::Aborted));
        // The fast-path fires before any route is consulted.
        assert_eq!(transport.requests().len(), 1);
    }

    #[tokio::test]
    async fn aborts_mid_flight_through_a_delayed_route() {
        let mut transport = MockTransport::new();
        transport.push_delayed("/slow", Duration::from_secs(30), 200, "late");
        let signal = AbortSignal::new();
        let request = Request::get("https://example.com/slow").abort(signal.clone());

        let handle = tokio::spawn(async move { transport.execute(request).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        signal.abort();

        let err = handle.await.expect("join").expect_err("must abort");
        assert!(matches!(err, TransportError::Aborted));
    }

    #[tokio::test]
    async fn routes_can_inspect_request_headers_and_method() {
        let mut transport = MockTransport::new();
        transport.push("/echo", 200, "hit");

        transport
            .execute(
                Request::post("https://example.com/echo")
                    .header("x-api-key", "secret")
                    .body(b"payload".to_vec()),
            )
            .await
            .expect("success");

        let logged = transport.requests();
        assert_eq!(logged[0].method, Method::Post);
        assert_eq!(logged[0].header_value("X-Api-Key"), Some("secret"));
        assert_eq!(logged[0].body.as_deref(), Some(&b"payload"[..]));
    }

    #[test]
    fn url_path_extracts_the_path_component() {
        assert_eq!(
            url_path("https://api.example.com/v1/status?q=1"),
            "/v1/status"
        );
        assert_eq!(url_path("https://api.example.com/v1/status"), "/v1/status");
        assert_eq!(url_path("http://127.0.0.1:8080/"), "/");
        assert_eq!(url_path("https://example.com"), "/");
    }
}
