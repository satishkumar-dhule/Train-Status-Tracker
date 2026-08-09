//! Port of `lib/providers/easemytrip.test.ts`, with the fetch leg driven
//! through [`MockTransport`].

use std::sync::Arc;

use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_easemytrip::{
    create_easemytrip_provider, map_easemytrip_html, parse_easemytrip_html, to_easemytrip_date,
    EaseMyTripProvider,
};
use tt_provider_http::MockTransport;

const ENDPOINT_PATH: &str = "/railways/train-live-status-with-click";

#[derive(Default)]
struct BlockOptions {
    current: bool,
    km: Option<&'static str>,
    delay: Option<&'static str>,
    arrival: Option<&'static str>,
    departure: Option<&'static str>,
    platform: Option<&'static str>,
}

fn station_block(code: &str, name: &str, opts: BlockOptions) -> String {
    let current_col = if opts.current { "arvd_sts_col" } else { " " };
    let current_dot = if opts.current {
        "arvd_sts_col_dot blink blue"
    } else {
        ""
    };
    let name_class = if opts.current {
        "arvd_sts_sec station-name"
    } else {
        "station-name"
    };
    format!(
        r#"<div class="station-item ">
    <div class="station-item_inner">
        <div class="left-col">
            <div class="code">{code}</div>
            <div class="km">{km}</div>
        </div>
        <div class="line-col {current_col}">
            <div class="dot {current_dot}"></div>
        </div>
        <div class="right-col">
            <div class="{name_class}">
                <a href="https://www.easemytrip.com/railways/x/">
                    <span>{name}</span>
                </a>
                <span>PF {platform}</span>
            </div>
            <div class="delay">
                <span>{delay}</span>
            </div>
            <div class="avl_times">
                <span>{arrival}</span>
            </div>
            <div class="dprt_times">
                <span>{departure}</span>
                <span class=""></span>
            </div>
        </div>
    </div>
</div>"#,
        km = opts.km.unwrap_or("0.0 Km"),
        delay = opts.delay.unwrap_or("On Time"),
        arrival = opts.arrival.unwrap_or(""),
        departure = opts.departure.unwrap_or(""),
        platform = opts.platform.unwrap_or(""),
    )
}

const INTERMEDIATE_BLOCK: &str = r#"<div class="station-item ">
    <div class="station-item_inner inner_station_btn_sec">
        <p class="inner_station_btn">17 Intermediate Stations</p>
    </div>
    <div id="intermediate_0" style="display:none;">
        <div class="station-item_inner inner_station_div">
            <div class="station-name">
                <span>Bby Mahalakshmi</span>
                <span>PF </span>
            </div>
            <div class="delay"><span>-</span></div>
            <div class="avl_times"><span>17:01</span></div>
            <div class="dprt_times"><span>17:01</span></div>
        </div>
    </div>
</div>"#;

const HEADER_BLOCK: &str = r#"<div class="station-item station-item_top blu">
    <div class="station-item_inner">
        <div class="station-name">Stations</div>
    </div>
</div>
<div class="station-item date_label_prnt">
    <div class="station-item_inner ">Day 1</div>
</div>"#;

fn fixture_html() -> String {
    format!(
        r#"<html><body>
    <h2 class="bs-pra mf16 mt10">
        12951 Tejas Rajdhani Running Status
    </h2>
    <p class="f11_ mt_10">
        <strong>Last Updated:</strong>
        10 minutes ago
    </p>
    {header}
    {mmct}
    {intermediate}
    {bvi}
    {ndls}
</body></html>"#,
        header = HEADER_BLOCK,
        mmct = station_block(
            "MMCT",
            "Mumbai Central",
            BlockOptions {
                current: true,
                departure: Some("17:00"),
                ..BlockOptions::default()
            },
        ),
        intermediate = INTERMEDIATE_BLOCK,
        bvi = station_block(
            "BVI",
            "Borivali",
            BlockOptions {
                km: Some("30.0 Km"),
                arrival: Some("17:20"),
                departure: Some("17:22"),
                platform: Some("6"),
                ..BlockOptions::default()
            },
        ),
        ndls = station_block(
            "NDLS",
            "New Delhi",
            BlockOptions {
                km: Some("1384.0 Km"),
                delay: Some("Late by 10 min"),
                arrival: Some("08:32"),
                platform: Some("3"),
                ..BlockOptions::default()
            },
        ),
    )
}

fn known_train() -> KnownTrain {
    KnownTrain {
        number: "12951".to_string(),
        name: "Tejas Rajdhani Express".to_string(),
    }
}

fn assemble_options() -> AssembleOptions {
    AssembleOptions {
        train_number: "12951".to_string(),
        departure_date: "20260806".to_string(),
        known_train: Some(known_train()),
        ..AssembleOptions::default()
    }
}

#[test]
fn to_easemytrip_date_converts_yyyymmdd_to_dd_mm_yyyy() {
    assert_eq!(
        to_easemytrip_date("20260806"),
        Some("06/08/2026".to_string())
    );
}

#[test]
fn to_easemytrip_date_returns_none_for_malformed_dates() {
    assert_eq!(to_easemytrip_date("bogus"), None);
}

#[test]
fn parses_real_stations_and_skips_intermediate_stations() {
    let parsed = parse_easemytrip_html(&fixture_html());

    assert_eq!(parsed.title_train_number.as_deref(), Some("12951"));
    assert_eq!(parsed.last_updated.as_deref(), Some("10 minutes ago"));
    assert_eq!(parsed.current_station_code.as_deref(), Some("MMCT"));
    let codes: Vec<_> = parsed
        .rows
        .iter()
        .map(|row| row.station_code.as_str())
        .collect();
    assert_eq!(codes, ["MMCT", "BVI", "NDLS"]);

    let mmct = &parsed.rows[0];
    assert_eq!(mmct.station_code, "MMCT");
    assert_eq!(mmct.station_name, "Mumbai Central");
    assert_eq!(mmct.scheduled_departure.as_deref(), Some("17:00"));
    assert_eq!(mmct.scheduled_arrival, None);
    assert_eq!(mmct.delay_minutes, Some(0));
    assert_eq!(mmct.distance, Some(0));
    assert_eq!(mmct.platform, None);

    let bvi = &parsed.rows[1];
    assert_eq!(bvi.station_code, "BVI");
    assert_eq!(bvi.station_name, "Borivali");
    assert_eq!(bvi.scheduled_arrival.as_deref(), Some("17:20"));
    assert_eq!(bvi.scheduled_departure.as_deref(), Some("17:22"));
    assert_eq!(bvi.platform.as_deref(), Some("6"));
    assert_eq!(bvi.distance, Some(30));
    assert_eq!(bvi.delay_minutes, Some(0));

    let ndls = &parsed.rows[2];
    assert_eq!(ndls.station_code, "NDLS");
    assert_eq!(ndls.station_name, "New Delhi");
    assert_eq!(ndls.scheduled_arrival.as_deref(), Some("08:32"));
    assert_eq!(ndls.scheduled_departure, None);
    assert_eq!(ndls.platform.as_deref(), Some("3"));
    assert_eq!(ndls.delay_minutes, Some(10));
}

#[test]
fn maps_the_page_to_a_full_status() {
    let status = map_easemytrip_html(&fixture_html(), &assemble_options()).expect("maps");

    assert_eq!(status.train_name, "Tejas Rajdhani Express");
    assert_eq!(status.source_station_code, "MMCT");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("MMCT"));
    assert_eq!(
        status.current_station_name.as_deref(),
        Some("Mumbai Central")
    );
    assert_eq!(status.current_delay_minutes, Some(0));
    assert_eq!(status.last_updated.as_deref(), Some("10 minutes ago"));
    assert_eq!(status.status_message, None);

    assert!(status.stations[0].is_current);
    assert!(!status.stations[0].has_departed);
    assert!(!status.stations[1].has_departed);
    assert!(!status.stations[2].has_departed);
}

#[test]
fn reports_not_found_when_the_page_does_not_name_the_train() {
    let err = map_easemytrip_html("<html><body><p>oops</p></body></html>", &assemble_options())
        .expect_err("must be not-found");
    assert!(matches!(err, ProviderError::NotFound { .. }));
}

#[test]
fn reports_upstream_error_when_title_exists_but_no_stations_parse() {
    let err = map_easemytrip_html(
        "<h2>12951 Tejas Rajdhani Running Status</h2><p>layout changed</p>",
        &assemble_options(),
    )
    .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn builds_the_expected_url_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push(ENDPOINT_PATH, 200, fixture_html().into_bytes());
    let transport = Arc::new(transport);
    let provider = EaseMyTripProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12951",
            "20260806",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.current_station_code.as_deref(), Some("MMCT"));

    let url = url::Url::parse(&transport.requests()[0].url).expect("valid url");
    assert_eq!(url.scheme(), "https");
    assert_eq!(url.host_str(), Some("www.easemytrip.com"));
    assert_eq!(url.path(), ENDPOINT_PATH);
    let pairs: Vec<_> = url.query_pairs().collect();
    assert!(pairs.contains(&("trainnumber".into(), "12951".into())));
    assert!(pairs.contains(&("date".into(), "06/08/2026".into())));
}

#[test]
fn factory_returns_the_provider_with_the_right_name() {
    let provider = create_easemytrip_provider(Arc::new(MockTransport::new()));
    assert_eq!(provider.name(), "easemytrip");
}
