//! Rail Saarthi — `tt-provider-http` crate.
//!
//! Seam: HTTP transport client: timeouts, redirect cap, abort, max bytes.
//!
//! Deep module: the public surface lives in [`transport`] and is re-exported
//! from this file; the implementations ([`ReqwestTransport`], and the
//! test-only [`MockTransport`]) are private modules.
//!
//! # What every provider adapter sees
//!
//! - [`Request`] / [`Response`] — the small, ergonomic pair providers build and
//!   consume. Requests carry an optional per-request [`Request::timeout`] and
//!   an optional [`tt_provider_core::AbortSignal`] via [`Request::abort`].
//! - [`TransportError`] — the classified failure taxonomy (timeout, network,
//!   redirect limit, oversized, non-2xx status, aborted, other), mirroring the
//!   `UpstreamOutcome` classification in `providers/http.ts`.
//! - [`HttpTransport`] — the injectable seam. Providers depend on this trait,
//!   never on reqwest.
//!
//! Non-2xx responses do **not** come back as [`Response`]; they surface as
//! [`TransportError::Status`]. A returned [`Response`] is always a fully
//! buffered 2xx body.
//!
//! # Testing
//!
//! Provider crates test hermetically against [`MockTransport`], which mirrors
//! [`ReqwestTransport`]'s classification without touching the network. Enable
//! it as a dev-dependency feature:
//!
//! ```toml
//! [dev-dependencies]
//! tt-provider-http = { path = "../provider-http", features = ["testkit"] }
//! ```
//!
//! # Constants
//!
//! | Constant | Value | Source |
//! |---|---|---|
//! | [`DEFAULT_TIMEOUT`] | 10 s | `DEFAULT_UPSTREAM_TIMEOUT_MS` |
//! | [`DEFAULT_MAX_RESPONSE_BYTES`] | 2 MiB | `DEFAULT_UPSTREAM_MAX_BYTES` |
//! | [`DEFAULT_MAX_REDIRECTS`] | 3 | Rust seam (TS fetch default is 20) |

mod fetch;
#[cfg(any(test, feature = "testkit"))]
mod mock_transport;
mod reqwest_transport;
#[cfg(test)]
mod test_server;
mod transport;

pub use fetch::{fetch_provider_json, fetch_provider_text};
#[cfg(any(test, feature = "testkit"))]
pub use mock_transport::MockTransport;
pub use reqwest_transport::ReqwestTransport;
pub use transport::{
    HttpTransport, Method, Request, Response, TransportError, DEFAULT_MAX_REDIRECTS,
    DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT,
};
