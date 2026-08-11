//! Tests for the erail.in HTML-scraper adapter, with the fetch leg driven
//! through [`MockTransport`]. Fixtures mirror the documented embedded-JSON and
//! schedule-table structures in `src/map.rs` for train 12301 (HWH → ASN →
//! NDLS). erail's server page is a *schedule* source, so actuals are absent.

use std::sync::Arc;

use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_erail::{create_erail_provider, map_erail_payload, to_erail_date, ErailProvider};
use tt_provider_http::MockTransport;

const ENDPOINT_PATH: &str = "/train-enquiry/12301";

fn embedded_json_fixture() -> String {
    r#"<html><body>
    <h2>12301 Howrah - New Delhi Rajdhani</h2>
    <script type="text/javascript">
        var __init = { "page": "train-enquiry", "trainNo": "12301" };
        var trainSchedule = [
            { "stnCode": "HWH", "stnName": "HOWRAH JN", "schArr": "--", "schDep": "16:50", "pf": "9", "day": 1 },
            { "stnCode": "ASN", "stnName": "ASANSOL JN", "schArr": "18:47", "schDep": "18:49", "pf": "4", "day": 1 },
            { "stnCode": "NDLS", "stnName": "NEW DELHI", "schArr": "10:05", "schDep": "--", "pf": 14, "day": 2 }
        ];
    </script>
</body></html>"#
        .to_string()
}

fn table_fallback_fixture() -> String {
    r#"<html><body>
    <h2>12301 Howrah - New Delhi Rajdhani</h2>
    <table class="erail-train-schedule">
        <tr class="schedule-row">
            <td class="stn">HWH</td><td class="stn-name">HOWRAH JN</td>
            <td class="sch-arr">--</td><td class="sch-dep">16:50</td>
            <td class="pf">9</td><td class="day">1</td>
        </tr>
        <tr class="schedule-row">
            <td class="stn">ASN</td><td class="stn-name">ASANSOL JN</td>
            <td class="sch-arr">18:47</td><td class="sch-dep">18:49</td>
            <td class="pf">4</td><td class="day">1</td>
        </tr>
        <tr class="schedule-row">
            <td class="stn">NDLS</td><td class="stn-name">NEW DELHI</td>
            <td class="sch-arr">10:05</td><td class="sch-dep">--</td>
            <td class="pf">14</td><td class="day">2</td>
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
fn to_erail_date_passes_yyyymmdd_through() {
    assert_eq!(to_erail_date("20260810"), Some("20260810".to_string()));
}

#[test]
fn to_erail_date_returns_none_for_malformed_dates() {
    assert_eq!(to_erail_date("2026-08-10"), None);
    assert_eq!(to_erail_date("notadate"), None);
}

#[test]
fn maps_the_embedded_json_schedule() {
    let status = map_erail_payload(&embedded_json_fixture(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code, None);
    assert_eq!(status.current_delay_minutes, None);
    assert_eq!(status.stations.len(), 3);

    let hwh = &status.stations[0];
    assert_eq!(hwh.station_code, "HWH");
    assert_eq!(hwh.station_name, "HOWRAH JN");
    assert_eq!(hwh.scheduled_arrival, None);
    assert_eq!(hwh.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(hwh.actual_arrival, None);
    assert_eq!(hwh.actual_departure, None);
    assert_eq!(hwh.delay_minutes, None);
    assert_eq!(hwh.platform.as_deref(), Some("9"));
    assert_eq!(hwh.day, 1);

    let asn = &status.stations[1];
    assert_eq!(asn.station_code, "ASN");
    assert_eq!(asn.scheduled_arrival.as_deref(), Some("18:47"));
    assert_eq!(asn.scheduled_departure.as_deref(), Some("18:49"));
    assert_eq!(asn.actual_arrival, None);
    assert_eq!(asn.platform.as_deref(), Some("4"));

    let ndls = &status.stations[2];
    assert_eq!(ndls.station_code, "NDLS");
    assert_eq!(ndls.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(ndls.scheduled_departure, None);
    assert_eq!(ndls.platform.as_deref(), Some("14"));
    assert_eq!(ndls.day, 2);
}

#[test]
fn falls_back_to_the_schedule_table_without_embedded_json() {
    let status = map_erail_payload(&table_fallback_fixture(), &assemble_options()).expect("maps");

    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code, None);
    assert_eq!(status.stations.len(), 3);

    let asn = &status.stations[1];
    assert_eq!(asn.station_code, "ASN");
    assert_eq!(asn.scheduled_arrival.as_deref(), Some("18:47"));
    assert_eq!(asn.scheduled_departure.as_deref(), Some("18:49"));
    assert_eq!(asn.actual_arrival, None);
    assert_eq!(asn.delay_minutes, None);
    assert_eq!(asn.platform.as_deref(), Some("4"));
}

#[test]
fn reports_upstream_when_no_recognisable_data_is_present() {
    let err = map_erail_payload("<html><body><p>oops</p></body></html>", &assemble_options())
        .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn reports_upstream_when_embedded_json_has_no_stations() {
    let html = r#"<script type="text/javascript">var trainSchedule = [];</script>"#;
    let err = map_erail_payload(html, &assemble_options()).expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn issues_a_get_with_the_train_enquiry_path() {
    let mut transport = MockTransport::new();
    transport.push(ENDPOINT_PATH, 200, embedded_json_fixture().into_bytes());
    let transport = Arc::new(transport);
    let provider = ErailProvider::new(transport.clone());

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
    assert_eq!(parsed.host_str(), Some("erail.in"));
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    assert!(parsed.query().is_none());
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_erail_provider(Arc::new(MockTransport::new()));
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
    let provider = create_erail_provider(Arc::new(MockTransport::new()));
    assert_eq!(provider.name(), "erail");
    assert!(provider.enabled());
}
