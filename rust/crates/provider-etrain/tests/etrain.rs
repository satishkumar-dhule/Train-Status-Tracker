//! Tests for the etrain.info HTML-scraper adapter, with the fetch leg driven
//! through [`MockTransport`]. The fixture mirrors the documented running-status
//! table structure in `src/map.rs` for train 12301 (HWH → ASN → NDLS).

use std::sync::Arc;

use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_etrain::{
    create_etrain_provider, map_etrain_payload, to_etrain_date, EtrainProvider,
};
use tt_provider_http::MockTransport;

const ENDPOINT_PATH: &str = "/train/12301/live";

fn fixture_html() -> String {
    r#"<html><body>
    <h2>12301 Howrah - New Delhi Rajdhani Running Status</h2>
    <table class="etrain-running-status">
        <tr class="status-row">
            <td class="stn">HWH</td>
            <td class="stn-name">HOWRAH JN</td>
            <td class="sch-arr">--</td>
            <td class="sch-dep">16:50</td>
            <td class="act-arr">--</td>
            <td class="act-dep">16:50</td>
            <td class="pf">9</td>
            <td class="day">1</td>
            <td class="delay">On time</td>
        </tr>
        <tr class="status-row">
            <td class="stn">ASN</td>
            <td class="stn-name">ASANSOL JN</td>
            <td class="sch-arr">18:47</td>
            <td class="sch-dep">18:49</td>
            <td class="act-arr">18:57</td>
            <td class="act-dep">19:02</td>
            <td class="pf">4</td>
            <td class="day">1</td>
            <td class="delay">Late by 10 min</td>
        </tr>
        <tr class="status-row">
            <td class="stn">NDLS</td>
            <td class="stn-name">NEW DELHI</td>
            <td class="sch-arr">10:05</td>
            <td class="sch-dep">--</td>
            <td class="act-arr">10:05</td>
            <td class="act-dep">--</td>
            <td class="pf">14</td>
            <td class="day">2</td>
            <td class="delay">On time</td>
        </tr>
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
fn to_etrain_date_passes_yyyymmdd_through() {
    assert_eq!(to_etrain_date("20260810"), Some("20260810".to_string()));
}

#[test]
fn to_etrain_date_returns_none_for_malformed_dates() {
    assert_eq!(to_etrain_date("2026-08-10"), None);
    assert_eq!(to_etrain_date("notadate"), None);
}

#[test]
fn maps_a_full_running_status_table() {
    let status = map_etrain_payload(&fixture_html(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("NDLS"));
    assert_eq!(status.current_station_name.as_deref(), Some("NEW DELHI"));
    assert_eq!(status.current_delay_minutes, Some(0));
    assert_eq!(status.stations.len(), 3);

    let hwh = &status.stations[0];
    assert_eq!(hwh.station_code, "HWH");
    assert_eq!(hwh.station_name, "HOWRAH JN");
    assert_eq!(hwh.scheduled_arrival, None);
    assert_eq!(hwh.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(hwh.actual_arrival, None);
    assert_eq!(hwh.actual_departure.as_deref(), Some("16:50"));
    assert_eq!(hwh.platform.as_deref(), Some("9"));
    assert_eq!(hwh.day, 1);
    assert_eq!(hwh.delay_minutes, Some(0));
    assert!(hwh.has_departed);
    assert!(!hwh.is_current);

    let asn = &status.stations[1];
    assert_eq!(asn.station_code, "ASN");
    assert_eq!(asn.scheduled_arrival.as_deref(), Some("18:47"));
    assert_eq!(asn.scheduled_departure.as_deref(), Some("18:49"));
    assert_eq!(asn.actual_arrival.as_deref(), Some("18:57"));
    assert_eq!(asn.actual_departure.as_deref(), Some("19:02"));
    assert_eq!(asn.platform.as_deref(), Some("4"));
    assert_eq!(asn.delay_minutes, Some(10));
    assert!(asn.has_departed);

    let ndls = &status.stations[2];
    assert_eq!(ndls.station_code, "NDLS");
    assert_eq!(ndls.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(ndls.scheduled_departure, None);
    assert_eq!(ndls.actual_arrival.as_deref(), Some("10:05"));
    assert_eq!(ndls.actual_departure, None);
    assert_eq!(ndls.platform.as_deref(), Some("14"));
    assert_eq!(ndls.day, 2);
    assert_eq!(ndls.delay_minutes, Some(0));
    assert!(ndls.is_current);
    assert!(!ndls.has_departed);
}

#[test]
fn reports_upstream_when_the_running_status_table_is_missing() {
    let err = map_etrain_payload("<html><body><p>oops</p></body></html>", &assemble_options())
        .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
    assert!(err.to_string().contains("running-status table"));
}

#[test]
fn reports_upstream_when_the_table_has_no_station_rows() {
    let html = r#"<table class="etrain-running-status"><tr><td>layout changed</td></tr></table>"#;
    let err = map_etrain_payload(html, &assemble_options()).expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn classifies_the_anti_bot_json_body_as_upstream() {
    let html =
        r#"{"error":"Some feature has been Changed/Upgraded. Kindly refresh and try again."}"#;
    let err = map_etrain_payload(html, &assemble_options()).expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn issues_a_get_with_the_live_path_and_date_query() {
    let mut transport = MockTransport::new();
    transport.push(ENDPOINT_PATH, 200, fixture_html().into_bytes());
    let transport = Arc::new(transport);
    let provider = EtrainProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260810",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.current_station_code.as_deref(), Some("NDLS"));

    let request = &transport.requests()[0];
    assert_eq!(request.method.as_str(), "GET");
    let parsed = url::Url::parse(&request.url).expect("valid url");
    assert_eq!(parsed.scheme(), "https");
    assert_eq!(parsed.host_str(), Some("etrain.info"));
    assert!(parsed.path().contains("/train/"));
    assert!(parsed.path().contains("/live"));
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    let query: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    assert_eq!(query.get("date").map(String::as_str), Some("20260810"));
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_etrain_provider(Arc::new(MockTransport::new()));
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
    let provider = create_etrain_provider(Arc::new(MockTransport::new()));
    assert_eq!(provider.name(), "etrain");
    assert!(provider.enabled());
}
