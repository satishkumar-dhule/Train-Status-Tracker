//! Rail Saarthi — `tt-api-server` crate.
//!
//! Seam: axum app, routes, middleware, main binary.
//!
//! Deep module: keep the public surface in this file small and hide the
//! implementation in private submodules. The interface here is the test surface.
//!
//! The public seam is [`build_app`], which wires the full middleware stack
//! (request logging, CORS, security headers, RED metrics, panic handling)
//! around the mounted routes, plus the [`AppState`] it is built from. The
//! concrete middleware and handlers live in private submodules and are
//! exercised through this surface.

mod app;
mod middleware;
mod routes;

pub use app::{build_app, AppState};
