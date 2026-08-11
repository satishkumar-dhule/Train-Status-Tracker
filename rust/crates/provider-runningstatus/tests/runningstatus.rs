//! Tests for the runningstatus.in HTML scraper, driven through
//! [`MockTransport`]. The page structure is documented from Wayback snapshots
//! (Cloudflare-guarded from this sandbox); the fixture mirrors the RSTGCN
//! scrape shape for train 12301 (HWH → ASN → NDLS).

use std::sync::Arc;

use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_runningstatus::{
    create_runningstatus_provider, map_runningstatus_html, parse_runningstatus_html,
    to_runningstatus_date, RunningStatusProvider,
};

const ENDPOINT_PATH: &str = "/status/12301-on-20260810";

fn status_page_fixture() -> String {
    r#"<html><body>
    <h1>12301 Rajdhani Express Running Status</h1>
    <table class="status-table">
        <tr><td>HWH</td><td>HOWRAH JN</td><td>--</td><td>16:50</td><td>--</td><td>16:50</td><td>9</td></tr>
        <tr><td>ASN</td><td>ASANSOL JN</td><td>18:47</td><td>18:49</td><td>18:47</td><td>18:49</td><td>4</td></tr>
        <tr><td>NDLS</td><td>NEW DELHI</td><td>10:05</td><td>--</td><td>10:05</td><td>--</td><td>14</td></tr>
    </table>
    </body></html>"#
        .to_string()
}

fn known_train() -> KnownTrain {
    KnownTrain {
        number: "12301".to_string(),
        name: "Rajdhani Express".to_string(),
    }
}

fn assemble_options() -> AssembleOptions {
    AssembleOptions {
        train_number: "12301".to_string(),
        departure_date: "20260810".to_string(),
        known_train: Some(known_train()),
        ..AssembleOptions::default()
    }
}

#[test]
fn to_runningstatus_date_passes_yyyymmdd_through() {
    assert_eq!(
        to_runningstatus_date("20260810"),
        Some("20260810".to_string())
    );
}

#[test]
fn to_runningstatus_date_returns_none_for_malformed_dates() {
    assert_eq!(to_runningstatus_date("2026-08-10"), None);
    assert_eq!(to_runningstatus_date("notadate"), None);
}

#[test]
fn maps_a_full_status_table() {
    let status = map_runningstatus_html(&status_page_fixture(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.stations.len(), 3);

    let hwh = &status.stations[0];
    assert_eq!(hwh.station_code, "HWH");
    assert_eq!(hwh.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(hwh.actual_departure.as_deref(), Some("16:50"));
    assert_eq!(hwh.scheduled_arrival, None);
    assert_eq!(hwh.platform.as_deref(), Some("9"));

    let asn = &status.stations[1];
    assert_eq!(asn.station_code, "ASN");
    assert_eq!(asn.scheduled_arrival.as_deref(), Some("18:47"));
    assert_eq!(asn.scheduled_departure.as_deref(), Some("18:49"));

    let ndls = &status.stations[2];
    assert_eq!(ndls.station_code, "NDLS");
    assert_eq!(ndls.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(ndls.scheduled_departure, None);
}

#[test]
fn parser_drops_rows_without_a_station_code() {
    let rows = parse_runningstatus_html("<table><tr><td>not-a-code</td><td>x</td></tr></table>");
    assert!(rows.is_empty());
}

#[test]
fn reports_upstream_when_no_station_rows_are_present() {
    let err = map_runningstatus_html("<html><body><p>oops</p></body></html>", &assemble_options())
        .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn issues_a_get_with_the_status_path() {
    let mut transport = MockTransport::new();
    transport.push(ENDPOINT_PATH, 200, status_page_fixture().into_bytes());
    let transport = Arc::new(transport);
    let provider = RunningStatusProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260810",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.stations.len(), 3);

    let request = &transport.requests()[0];
    assert_eq!(request.method.as_str(), "GET");
    let parsed = url::Url::parse(&request.url).expect("valid url");
    assert_eq!(parsed.scheme(), "https");
    assert_eq!(parsed.host_str(), Some("runningstatus.in"));
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    assert!(parsed.query().is_none());
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_runningstatus_provider(Arc::new(MockTransport::new()));
    let err = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "bogus",
            &ProviderFetchOptions::default(),
            None,
        ))
        .expect_err("must fail");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn factory_returns_the_provider_with_the_right_name() {
    let provider = create_runningstatus_provider(Arc::new(MockTransport::new()));
    assert_eq!(provider.name(), "runningstatus");
    assert!(provider.enabled());
}
