//! The production [`HttpTransport`] implementation backed by reqwest.
//!
//! Private implementation detail: the reqwest client, redirect policy, timeout
//! plumbing and byte cap all live behind the module boundary. The only thing
//! callers see is [`ReqwestTransport`] implementing [`HttpTransport`].

use std::time::Duration;

use async_trait::async_trait;

use crate::transport::{
    HttpTransport, Method, Request, Response, TransportError, DEFAULT_MAX_REDIRECTS,
    DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT,
};

/// A [`HttpTransport`] that speaks real HTTP through reqwest.
///
/// Enforces, per request: a total timeout (default [`DEFAULT_TIMEOUT`], covering
/// connect + headers + body), at most [`DEFAULT_MAX_REDIRECTS`] redirects, a
/// maximum response body of [`DEFAULT_MAX_RESPONSE_BYTES`] bytes, and the
/// [`tt_provider_core::AbortSignal`] attached to the request.
///
/// The client bypasses environment proxies for deterministic behavior; call
/// [`ReqwestTransport::with_client`] if proxy support is required.
#[derive(Debug, Clone)]
pub struct ReqwestTransport {
    client: reqwest::Client,
    default_timeout: Duration,
    max_redirects: usize,
    max_response_bytes: usize,
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl ReqwestTransport {
    /// Build a transport with the default policy:
    ///
    /// - total timeout [`DEFAULT_TIMEOUT`]
    /// - at most [`DEFAULT_MAX_REDIRECTS`] redirects
    /// - response body capped at [`DEFAULT_MAX_RESPONSE_BYTES`]
    /// - environment proxies bypassed
    pub fn new() -> Self {
        install_ring_crypto_provider();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(DEFAULT_MAX_REDIRECTS))
            .no_proxy()
            .build()
            .expect("reqwest client configuration is valid");
        Self {
            client,
            default_timeout: DEFAULT_TIMEOUT,
            max_redirects: DEFAULT_MAX_REDIRECTS,
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
        }
    }

    /// Wrap an existing reqwest client. The redirect policy and byte cap that
    /// ship with [`ReqwestTransport::new`] are *not* inferred from the client;
    /// configure them on the `ClientBuilder` (e.g. `redirect(Policy::limited(3))`)
    /// when injecting a custom client.
    pub fn with_client(client: reqwest::Client) -> Self {
        install_ring_crypto_provider();
        Self {
            client,
            default_timeout: DEFAULT_TIMEOUT,
            max_redirects: DEFAULT_MAX_REDIRECTS,
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
        }
    }

    /// Override the default per-request timeout.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.default_timeout = timeout;
        self
    }

    /// Override the redirect cap used for diagnostics in
    /// [`TransportError::RedirectLimit`]. Note: the actual redirect policy is
    /// fixed at client build time; this only renames the reported cap.
    pub fn with_max_redirects(mut self, max: usize) -> Self {
        self.max_redirects = max;
        self
    }

    /// Override the maximum response body bytes.
    pub fn with_max_response_bytes(mut self, max: usize) -> Self {
        self.max_response_bytes = max;
        self
    }

    fn build_request(
        &self,
        request: &Request,
        timeout: Duration,
    ) -> Result<reqwest::Request, TransportError> {
        let method = match request.method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
        };

        let mut builder = self.client.request(method, &request.url).timeout(timeout);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = &request.body {
            builder = builder.body(body.clone());
        }

        builder.build().map_err(|err| TransportError::Other {
            message: format!("invalid request: {err}"),
        })
    }

    async fn send(
        &self,
        request: reqwest::Request,
        timeout: Duration,
    ) -> Result<Response, TransportError> {
        let response = self
            .client
            .execute(request)
            .await
            .map_err(|err| self.classify(reqwest_error(&err), timeout))?;

        self.check_status(&response)?;
        self.check_content_length(&response)?;

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_ascii_lowercase(),
                    String::from_utf8_lossy(value.as_bytes()).into_owned(),
                )
            })
            .collect::<Vec<_>>();

        let body = self.read_body(response, timeout).await?;

        Ok(Response {
            status,
            headers,
            body,
        })
    }

    fn check_status(&self, response: &reqwest::Response) -> Result<(), TransportError> {
        let status = response.status().as_u16();
        if (200..300).contains(&status) {
            Ok(())
        } else {
            Err(TransportError::Status { status })
        }
    }

    fn check_content_length(&self, response: &reqwest::Response) -> Result<(), TransportError> {
        if let Some(length) = response.content_length() {
            let length = length as usize;
            if length > self.max_response_bytes {
                return Err(TransportError::Oversized {
                    limit: self.max_response_bytes,
                    received: length,
                });
            }
        }
        Ok(())
    }

    async fn read_body(
        &self,
        mut response: reqwest::Response,
        timeout: Duration,
    ) -> Result<Vec<u8>, TransportError> {
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|err| self.classify(reqwest_error(&err), timeout))?
        {
            body.extend_from_slice(&chunk);
            if body.len() > self.max_response_bytes {
                return Err(TransportError::Oversized {
                    limit: self.max_response_bytes,
                    received: body.len(),
                });
            }
        }
        Ok(body)
    }

    fn classify(&self, error: ReqwestError, timeout: Duration) -> TransportError {
        match error {
            ReqwestError::Timeout => TransportError::Timeout { timeout },
            ReqwestError::Redirect => TransportError::RedirectLimit {
                max: self.max_redirects,
            },
            ReqwestError::Network(message) => TransportError::Network { message },
        }
    }
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn execute(&self, request: Request) -> Result<Response, TransportError> {
        let timeout = request.timeout.unwrap_or(self.default_timeout);
        let abort = request.abort.clone();

        if let Some(signal) = &abort {
            if signal.is_aborted() {
                return Err(TransportError::Aborted);
            }
        }

        let reqwest_request = self.build_request(&request, timeout)?;

        match abort {
            Some(signal) => {
                tokio::select! {
                    result = self.send(reqwest_request, timeout) => result,
                    _ = signal.cancelled() => Err(TransportError::Aborted),
                }
            }
            None => self.send(reqwest_request, timeout).await,
        }
    }
}

/// A quick classification probe over a reqwest error, so we can branch on it
/// without passing the whole error around.
enum ReqwestError {
    Timeout,
    Redirect,
    Network(String),
}

fn reqwest_error(error: &reqwest::Error) -> ReqwestError {
    if error.is_timeout() {
        ReqwestError::Timeout
    } else if error.is_redirect() {
        ReqwestError::Redirect
    } else {
        ReqwestError::Network(error.to_string())
    }
}

/// reqwest's rustls backend carries no default crypto provider
/// (`rustls-no-provider`); install the ring provider once so HTTPS requests
/// work out of the box. No-op when the application has already installed a
/// provider (theirs wins).
fn install_ring_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::test_server::{RequestHead, TestResponse, TestServer};
    use tt_provider_core::AbortSignal;

    #[test]
    fn constructs_outside_a_runtime() {
        let _transport = ReqwestTransport::new();
    }

    #[tokio::test]
    async fn returns_2xx_body_and_headers() {
        let server = TestServer::start(|req: &RequestHead| {
            assert_eq!(req.path, "/status");
            TestResponse::new(200, r#"{"ok":true}"#).header("content-type", "application/json")
        })
        .await;

        let transport = ReqwestTransport::new();
        let response = transport
            .execute(Request::get(server.url("/status")))
            .await
            .expect("success");

        assert_eq!(response.status(), 200);
        assert_eq!(response.body(), br#"{"ok":true}"#);
        assert_eq!(response.header("content-type"), Some("application/json"));
        assert_eq!(response.json::<serde_json::Value>().unwrap()["ok"], true);
    }

    #[tokio::test]
    async fn posts_json_body_with_content_type() {
        let server = TestServer::start(|req: &RequestHead| {
            assert_eq!(req.method, "POST");
            assert_eq!(req.path, "/status");
            TestResponse::new(200, req.body.clone().unwrap_or_default())
        })
        .await;

        let transport = ReqwestTransport::new();
        let body = serde_json::json!({ "train": "22943" });
        let request = Request::post(server.url("/status"))
            .json_body(&body)
            .expect("serialize")
            .timeout(Duration::from_secs(2));

        let response = transport.execute(request).await.expect("success");
        assert_eq!(
            response.json::<serde_json::Value>().unwrap()["train"],
            "22943"
        );
    }

    #[tokio::test]
    async fn classifies_non_2xx_statuses() {
        let server = TestServer::start(|req: &RequestHead| match req.path.as_str() {
            "/server-error" => TestResponse::new(500, "boom"),
            "/not-found" => TestResponse::new(404, "nope"),
            path => panic!("unexpected path {path}"),
        })
        .await;

        let transport = ReqwestTransport::new();

        let err = transport
            .execute(Request::get(server.url("/server-error")))
            .await
            .expect_err("500 must fail");
        assert!(matches!(err, TransportError::Status { status: 500 }));

        let err = transport
            .execute(Request::get(server.url("/not-found")))
            .await
            .expect_err("404 must fail");
        assert!(matches!(err, TransportError::Status { status: 404 }));
    }

    #[tokio::test]
    async fn times_out_using_the_per_request_timeout() {
        let server = TestServer::start(|_req: &RequestHead| {
            TestResponse::new(200, "late").delay(Duration::from_millis(2_000))
        })
        .await;

        let transport = ReqwestTransport::new();
        let request = Request::get(server.url("/slow")).timeout(Duration::from_millis(100));

        let err = transport.execute(request).await.expect_err("must time out");
        assert!(matches!(
            err,
            TransportError::Timeout { timeout } if timeout == Duration::from_millis(100)
        ));
    }

    #[tokio::test]
    async fn rejects_oversized_by_content_length_without_reading_the_body() {
        let server = TestServer::start(|_req: &RequestHead| {
            TestResponse::new(200, "tiny").header("content-length", "1048576")
        })
        .await;

        let transport = ReqwestTransport::new().with_max_response_bytes(1024);
        let err = transport
            .execute(Request::get(server.url("/huge")))
            .await
            .expect_err("must be oversized");
        assert!(matches!(
            err,
            TransportError::Oversized {
                limit: 1024,
                received: 1048576
            }
        ));
    }

    #[tokio::test]
    async fn rejects_oversized_while_streaming_chunked_body() {
        let big_body = vec![b'x'; 4096];
        let server = TestServer::start(move |_req: &RequestHead| {
            TestResponse::new(200, big_body.clone()).chunked(true)
        })
        .await;

        let transport = ReqwestTransport::new().with_max_response_bytes(1024);
        let err = transport
            .execute(Request::get(server.url("/stream")))
            .await
            .expect_err("must be oversized");
        assert!(matches!(
            err,
            TransportError::Oversized {
                limit: 1024,
                received,
            } if received > 1024
        ));
    }

    #[tokio::test]
    async fn follows_redirects_up_to_the_cap() {
        let server = TestServer::start(|req: &RequestHead| match req.path.as_str() {
            "/start" => TestResponse::new(302, "").header("location", "/target"),
            "/target" => TestResponse::new(200, "redirected"),
            path => panic!("unexpected path {path}"),
        })
        .await;

        let transport = ReqwestTransport::new();
        let response = transport
            .execute(Request::get(server.url("/start")))
            .await
            .expect("redirect must be followed");
        assert_eq!(response.status(), 200);
        assert_eq!(response.text().unwrap(), "redirected");
    }

    #[tokio::test]
    async fn errors_after_the_redirect_cap_is_exhausted() {
        let server = TestServer::start(|req: &RequestHead| {
            let next = match req.path.as_str() {
                "/r0" => "/r1",
                "/r1" => "/r2",
                "/r2" => "/r3",
                "/r3" => "/r4",
                "/r4" => "/r5",
                path => panic!("unexpected path {path}"),
            };
            TestResponse::new(302, "").header("location", next)
        })
        .await;

        let transport = ReqwestTransport::new();
        let err = transport
            .execute(Request::get(server.url("/r0")))
            .await
            .expect_err("redirect cap must fail");
        assert!(matches!(err, TransportError::RedirectLimit { max: 3 }));
    }

    #[tokio::test]
    async fn aborts_an_in_flight_request() {
        let server = TestServer::start(|_req: &RequestHead| {
            TestResponse::new(200, "never").delay(Duration::from_secs(30))
        })
        .await;

        let transport = ReqwestTransport::new();
        let signal = AbortSignal::new();
        let request = Request::get(server.url("/hang")).abort(signal.clone());

        let handle = tokio::spawn(async move { transport.execute(request).await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        signal.abort();

        let err = handle.await.expect("join").expect_err("must abort");
        assert!(matches!(err, TransportError::Aborted));
    }

    #[tokio::test]
    async fn aborts_immediately_when_the_signal_is_already_fired() {
        let server = TestServer::start(|_req: &RequestHead| TestResponse::new(200, "ok")).await;

        let transport = ReqwestTransport::new();
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
            .execute(Request::get(server.url("/now")).abort(signal))
            .await
            .expect_err("already aborted must fail");
        assert!(matches!(err, TransportError::Aborted));
        assert_eq!(server.hits(), 0, "no network request may be sent");
    }

    #[tokio::test]
    async fn classifies_connection_refusals_as_network_errors() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);

        let transport = ReqwestTransport::new();
        let err = transport
            .execute(Request::get(format!("http://{addr}/down")))
            .await
            .expect_err("refused connection must fail");
        assert!(matches!(err, TransportError::Network { .. }));
    }

    #[tokio::test]
    async fn reports_invalid_urls_as_other() {
        let transport = ReqwestTransport::new();
        let err = transport
            .execute(Request::get("not a url"))
            .await
            .expect_err("invalid url must fail");
        assert!(matches!(err, TransportError::Other { .. }));
    }

    #[tokio::test]
    async fn without_an_abort_signal_requests_flow_normally() {
        let server = TestServer::start(|_req: &RequestHead| TestResponse::new(200, "ok")).await;

        let transport = ReqwestTransport::new();
        let response = transport
            .execute(Request::get(server.url("/no-abort")))
            .await
            .expect("success");
        assert_eq!(response.text().unwrap(), "ok");
    }
}
