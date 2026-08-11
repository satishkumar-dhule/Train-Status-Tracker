//! RailMitra adapter tests: the fetch leg is driven through
//! [`MockTransport`]; fixtures mirror the documented server-rendered station
//! table for train 12301 (HWH → ASN → NDLS).

use std::sync::Arc;

use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_railmitra::{
    create_railmitra_provider, map_railmitra_payload, to_railmitra_date, RailMitraProvider,
};

const ENDPOINT_PATH: &str = "/live-train-running-status/12301";

#[derive(Default)]
struct RowOptions {
    code: &'static str,
    name: &'static str,
    scheduled_arrival: &'static str,
    scheduled_departure: &'static str,
    actual_arrival: &'static str,
    actual_departure: &'static str,
    platform: &'static str,
    day: &'static str,
    delay: &'static str,
    status: &'static str,
}

fn station_row(opts: RowOptions) -> String {
    format!(
        r#"<tr class="station-row">
    <td class="station-code">{code}</td>
    <td class="station-name">{name}</td>
    <td class="scheduled-arrival">{sch_arr}</td>
    <td class="scheduled-departure">{sch_dep}</td>
    <td class="actual-arrival">{act_arr}</td>
    <td class="actual-departure">{act_dep}</td>
    <td class="platform">{platform}</td>
    <td class="day">{day}</td>
    <td class="delay">{delay}</td>
    <td class="status">{status}</td>
</tr>"#,
        code = opts.code,
        name = opts.name,
        sch_arr = opts.scheduled_arrival,
        sch_dep = opts.scheduled_departure,
        act_arr = opts.actual_arrival,
        act_dep = opts.actual_departure,
        platform = opts.platform,
        day = opts.day,
        delay = opts.delay,
        status = opts.status,
    )
}

fn fixture_html() -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <title>12301 Train Running Status (RAJDHANI EXPRES)</title>
</head>
<body>
    <table class="table station-table">
        <thead>
            <tr>
                <th>Station</th><th>Name</th><th>Sch Arr</th><th>Sch Dep</th>
                <th>Act Arr</th><th>Act Dep</th><th>PF</th><th>Day</th><th>Delay</th><th>Status</th>
            </tr>
        </thead>
        <tbody>
            {hwh}
            {asn}
            {ndls}
        </tbody>
    </table>
</body>
</html>"#,
        hwh = station_row(RowOptions {
            code: "HWH",
            name: "Howrah Jn",
            scheduled_arrival: "--:--",
            scheduled_departure: "16:50",
            actual_arrival: "",
            actual_departure: "16:50",
            platform: "9",
            day: "1",
            delay: "0 min",
            status: "Departed",
        }),
        asn = station_row(RowOptions {
            code: "ASN",
            name: "Asansol Jn",
            scheduled_arrival: "18:47",
            scheduled_departure: "18:49",
            actual_arrival: "",
            actual_departure: "",
            platform: "4",
            day: "1",
            delay: "10 min",
            status: "Expected",
        }),
        ndls = station_row(RowOptions {
            code: "NDLS",
            name: "New Delhi",
            scheduled_arrival: "10:05",
            scheduled_departure: "--:--",
            actual_arrival: "",
            actual_departure: "",
            platform: "14",
            day: "2",
            delay: "2 min",
            status: "Expected",
        }),
    )
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
fn to_railmitra_date_validates_yyyymmdd() {
    assert_eq!(to_railmitra_date("20260810"), Some("20260810".to_string()));
    assert_eq!(to_railmitra_date("2026-08-10"), None);
    assert_eq!(to_railmitra_date("notadate"), None);
}

#[test]
fn maps_a_full_page() {
    let status = map_railmitra_payload(&fixture_html(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.source_station_name, "Howrah Jn");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("ASN"));
    assert_eq!(status.current_station_name.as_deref(), Some("Asansol Jn"));
    assert_eq!(status.current_delay_minutes, Some(10));
    assert_eq!(status.stations.len(), 3);

    let hwh = &status.stations[0];
    assert_eq!(hwh.station_code, "HWH");
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
    assert_eq!(asn.actual_arrival, None);
    assert_eq!(asn.actual_departure, None);
    assert_eq!(asn.platform.as_deref(), Some("4"));
    assert_eq!(asn.day, 1);
    assert_eq!(asn.delay_minutes, Some(10));
    assert!(!asn.has_departed);
    assert!(asn.is_current);

    let ndls = &status.stations[2];
    assert_eq!(ndls.station_code, "NDLS");
    assert_eq!(ndls.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(ndls.scheduled_departure, None);
    assert_eq!(ndls.platform.as_deref(), Some("14"));
    assert_eq!(ndls.day, 2);
    assert_eq!(ndls.delay_minutes, Some(2));
    assert!(!ndls.has_departed);
    assert!(!ndls.is_current);
}

#[test]
fn reports_upstream_when_title_is_present_but_no_table_parses() {
    let err = map_railmitra_payload(
        "<html><head><title>12301 Train Running Status (RAJDHANI EXPRES)</title></head>\
         <body>layout changed</body></html>",
        &assemble_options(),
    )
    .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
    assert!(err.to_string().contains("no station table parsed"));
}

#[test]
fn reports_upstream_when_no_status_page_markers_are_present() {
    let err = map_railmitra_payload("<html><body><p>oops</p></body></html>", &assemble_options())
        .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn issues_a_get_against_the_live_running_status_path() {
    let mut transport = MockTransport::new();
    transport.push(ENDPOINT_PATH, 200, fixture_html().into_bytes());
    let transport = Arc::new(transport);
    let provider = RailMitraProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260810",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.current_station_code.as_deref(), Some("ASN"));

    let request = &transport.requests()[0];
    assert_eq!(request.method.as_str(), "GET");
    let parsed = url::Url::parse(&request.url).expect("valid url");
    assert_eq!(parsed.host_str(), Some("www.railmitra.com"));
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    assert_eq!(parsed.query(), None);
    assert!(request
        .header_value("User-Agent")
        .unwrap_or("")
        .starts_with("Mozilla/5.0"));
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_railmitra_provider(Arc::new(MockTransport::new()));
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
    let provider = create_railmitra_provider(Arc::new(MockTransport::new()));
    assert_eq!(provider.name(), "railmitra");
    assert!(provider.enabled());
}
