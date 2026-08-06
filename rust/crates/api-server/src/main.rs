//! Binary bootstrap: config, logging, telemetry, server, graceful shutdown.
//!
//! Ports `index.ts` + `server.ts`: parse the environment, install the JSON
//! logger, init telemetry (inert when disabled), bind `0.0.0.0:PORT`, and drain
//! in-flight requests on SIGTERM/SIGINT before flushing telemetry.

use std::sync::Arc;

use tt_api_server::build_app;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = tt_config::Config::from_env();
    let _log_guard = tt_logging::init(tt_logging::Level::parse(Some(&config.log_level)));
    let telemetry = Arc::new(tt_telemetry::init(&config));

    let app = build_app(config.clone(), Arc::clone(&telemetry));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(port = config.port, "server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("server stopped; flushing telemetry");
    if let Ok(telemetry) = Arc::try_unwrap(telemetry) {
        telemetry.shutdown();
    }
    Ok(())
}

/// Resolves when SIGINT (Ctrl+C) or SIGTERM arrives; on non-Unix platforms only
/// SIGINT is available.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
