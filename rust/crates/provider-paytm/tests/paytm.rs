//! Port of `lib/paytm-client.test.ts` (parse + fetch classification) and
//! `lib/providers/paytm.test.ts` (mapping + provider), with the fetch leg
//! driven through [`MockTransport`].

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{AbortSignal, ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{HttpTransport, MockTransport, Request, Response, TransportError};
use tt_provider_paytm::{
    create_paytm_provider, map_paytm_payload, parse_paytm_response_body, PaytmError,
};

const TRAIN_NUMBER: &str = "22943";
const DEPARTURE_DATE: &str = "20260802";
const STATUS_PATH: &str = "/api/trains/v1/train/status";
const STATUS_URL: &str = "https://travel.paytm.com/api/trains/v1/train/status";

fn happy_raw() -> Value {
    json!({
        "status": { "result": "success" },
        "body": {
            "stations": [
                {
                    "stnSerialNumber": 1,
                    "stationCode": "ADI",
                    "stationName": "Ahmedabad Jn",
                    "arrivalTime": "22:40",
                    "departureTime": "23:00",
                    "dayCount": 1,
                    "distance": 0,
                    "expected_platform": 1,
                    "haltTime": 20,
                },
                {
                    "stnSerialNumber": 2,
                    "stationCode": "NDLS",
                    "stationName": "New Delhi",
                    "arrivalTime": "08:05",
                    "departureTime": "08:15",
                    "dayCount": 2,
                    "actual_arrival_time": "08:40",
                    "actual_departure_time": null,
                    "distance": 938,
                    "expected_platform": "3",
                    "haltTime": 10,
                },
            ],
            "current_station": "NDLS",
            "train_status_message": "<b>Running on time</b>",
            "server_timestamp": "2026-08-02T08:20:00+05:30",
        },
    })
}

fn known_train() -> KnownTrain {
    KnownTrain {
        number: TRAIN_NUMBER.to_string(),
        name: "Bandra Gujarat Express".to_string(),
    }
}

fn assemble_options() -> AssembleOptions {
    AssembleOptions {
        train_number: TRAIN_NUMBER.to_string(),
        departure_date: DEPARTURE_DATE.to_string(),
        known_train: None,
        ..AssembleOptions::default()
    }
}

fn mock_serving(body: Value) -> Arc<MockTransport> {
    let mut transport = MockTransport::new();
    transport.push_json(STATUS_PATH, &body);
    Arc::new(transport)
}

/// A transport that fails every request with a canned [`TransportError`],
/// letting the tests pin the exact upstream message per classification. The
/// variants that are also produced by `MockTransport` (abort, oversized body,
/// non-200 status) are covered there and deliberately absent here.
enum FailKind {
    Timeout,
    Network,
    RedirectLimit,
    Other,
}

struct FailTransport(FailKind);

#[async_trait]
impl HttpTransport for FailTransport {
    async fn execute(&self, _request: Request) -> Result<Response, TransportError> {
        Err(match &self.0 {
            FailKind::Timeout => TransportError::Timeout {
                timeout: Duration::from_secs(10),
            },
            FailKind::Network => TransportError::Network {
                message: "connection refused".to_string(),
            },
            FailKind::RedirectLimit => TransportError::RedirectLimit { max: 3 },
            FailKind::Other => TransportError::Other {
                message: "boom".to_string(),
            },
        })
    }
}

fn failing(kind: FailKind) -> Arc<dyn HttpTransport> {
    Arc::new(FailTransport(kind))
}

fn upstream_message(err: ProviderError) -> String {
    match err {
        ProviderError::Upstream { message, .. } => message,
        other => panic!("expected an upstream error, got {other:?}"),
    }
}

async fn fetch_upstream(transport: Arc<dyn HttpTransport>) -> ProviderError {
    let provider = create_paytm_provider(transport);
    provider
        .fetch_train_status(
            TRAIN_NUMBER,
            DEPARTURE_DATE,
            &ProviderFetchOptions::default(),
            None,
        )
        .await
        .expect_err("must fail")
}

mod parse {
    use super::*;

    #[test]
    fn returns_a_typed_payload_on_success() {
        let payload = parse_paytm_response_body(&happy_raw()).expect("success");
        assert_eq!(payload.stations.len(), 2);
        assert_eq!(payload.stations[0], happy_raw()["body"]["stations"][0]);
        assert_eq!(payload.current_station.as_deref(), Some("NDLS"));
        assert_eq!(
            payload.train_status_message.as_deref(),
            Some("<b>Running on time</b>")
        );
        assert_eq!(
            payload.server_timestamp.as_deref(),
            Some("2026-08-02T08:20:00+05:30")
        );
        assert_eq!(payload.stations[0]["haltTime"], 20);
        assert_eq!(payload.stations[1]["distance"], 938);
        assert_eq!(payload.stations[1]["expected_platform"], "3");
    }

    #[test]
    fn leaves_station_fields_raw() {
        let raw = json!({
            "status": { "result": "success" },
            "body": {
                "stations": [
                    {
                        "stnSerialNumber": "42",
                        "stationCode": 123,
                        "distance": "100",
                        "expected_platform": 7,
                    },
                ],
                "current_station": null,
            },
        });
        let payload = parse_paytm_response_body(&raw).expect("success");
        assert_eq!(
            payload.stations[0],
            json!({
                "stnSerialNumber": "42",
                "stationCode": 123,
                "distance": "100",
                "expected_platform": 7,
            })
        );
        assert_eq!(payload.current_station, None);
    }

    #[test]
    fn rejects_non_object_raw_payloads() {
        for raw in [Value::Null, json!("x"), json!(5), json!(false), json!([])] {
            assert!(
                matches!(
                    parse_paytm_response_body(&raw),
                    Err(PaytmError::Upstream(message))
                        if message == "Unexpected response shape from Paytm"
                ),
                "expected upstream for {raw}"
            );
        }
    }

    #[test]
    fn rejects_a_missing_body() {
        let err = parse_paytm_response_body(&json!({ "foo": "bar" })).expect_err("must fail");
        assert!(matches!(
            err,
            PaytmError::Upstream(message) if message == "Unexpected response shape from Paytm"
        ));
    }

    #[test]
    fn rejects_a_non_object_body() {
        let err = parse_paytm_response_body(&json!({ "body": null })).expect_err("must fail");
        assert!(matches!(
            err,
            PaytmError::Upstream(message) if message == "Unexpected response shape from Paytm"
        ));
    }

    #[test]
    fn reports_a_confirmed_failure_as_not_found() {
        let err = parse_paytm_response_body(&json!({
            "error": true,
            "status": { "result": "failure" },
        }))
        .expect_err("must fail");
        assert!(matches!(
            err,
            PaytmError::NotFound(message) if message == "Train not found or no data available"
        ));
    }

    #[test]
    fn reports_an_ambiguous_error_result_as_upstream() {
        let err = parse_paytm_response_body(&json!({
            "error": true,
            "status": { "result": "service_unavailable" },
        }))
        .expect_err("must fail");
        assert!(matches!(
            err,
            PaytmError::Upstream(message)
                if message == r#"Paytm reported an unsuccessful result: "service_unavailable""#
        ));
    }

    #[test]
    fn reports_a_missing_result_marker_as_upstream() {
        let err = parse_paytm_response_body(&json!({
            "error": true,
            "status": {},
        }))
        .expect_err("must fail");
        assert!(matches!(
            err,
            PaytmError::Upstream(message) if message == r#"Paytm reported an unsuccessful result: """#
        ));
    }

    #[test]
    fn does_not_treat_a_successful_result_as_not_found() {
        let payload = parse_paytm_response_body(&json!({
            "error": true,
            "status": { "result": "success" },
            "body": { "stations": [], "current_station": null },
        }))
        .expect("must parse");
        assert!(payload.stations.is_empty());
    }

    #[test]
    fn a_falsy_error_is_ignored() {
        // JS: `if ("error" in raw && raw.error)` — `error: false` skips the
        // failure classification entirely even when the status says failure.
        let payload = parse_paytm_response_body(&json!({
            "error": false,
            "status": { "result": "failure" },
            "body": { "stations": [], "current_station": null },
        }))
        .expect("falsy error must be ignored");
        assert!(payload.stations.is_empty());
    }
}

mod map {
    use super::*;

    #[test]
    fn maps_the_payload_through_the_shared_normalizer() {
        let status = map_paytm_payload(
            &happy_raw(),
            &AssembleOptions {
                known_train: Some(known_train()),
                ..assemble_options()
            },
        )
        .expect("success");

        assert_eq!(status.train_name, "Bandra Gujarat Express");
        assert_eq!(status.current_station_code.as_deref(), Some("NDLS"));
        assert_eq!(status.current_station_name.as_deref(), Some("New Delhi"));
        assert_eq!(status.current_delay_minutes, Some(35));
        assert_eq!(status.status_message.as_deref(), Some("Running on time"));
        assert_eq!(
            status.last_updated.as_deref(),
            Some("2026-08-02T08:20:00+05:30")
        );

        let current = &status.stations[1];
        assert_eq!(current.station_code, "NDLS");
        assert!(current.is_current);
        assert_eq!(current.scheduled_arrival.as_deref(), Some("08:05"));
        assert_eq!(current.actual_arrival.as_deref(), Some("08:40"));
        assert_eq!(current.delay_minutes, Some(35));
        assert_eq!(current.day, 2);
        assert_eq!(current.platform.as_deref(), Some("3"));
        assert_eq!(current.halt_minutes, Some(10));
        assert_eq!(current.distance_from_source, Some(938));

        let first = &status.stations[0];
        assert_eq!(first.station_code, "ADI");
        assert_eq!(first.halt_minutes, Some(20));
        assert!(first.has_departed);
    }

    #[test]
    fn requires_a_day_count_for_scheduled_times() {
        // A "through" station with times but no day count gets no scheduled
        // times; both arrival and departure are suppressed.
        let raw = json!({
            "status": { "result": "success" },
            "body": {
                "stations": [
                    {
                        "stnSerialNumber": 1,
                        "stationCode": "ADI",
                        "stationName": "Ahmedabad Jn",
                        "arrivalTime": "22:40",
                        "departureTime": "23:00",
                    },
                ],
                "current_station": null,
            },
        });
        let status = map_paytm_payload(&raw, &assemble_options()).expect("success");
        assert_eq!(status.stations[0].scheduled_arrival, None);
        assert_eq!(status.stations[0].scheduled_departure, None);
    }

    #[test]
    fn a_zero_day_count_suppresses_scheduled_times_but_a_zero_string_allows_them() {
        let zero = map_paytm_payload(
            &json!({
                "status": { "result": "success" },
                "body": {
                    "stations": [{ "stationCode": "ADI", "arrivalTime": "22:40", "dayCount": 0 }],
                    "current_station": null,
                },
            }),
            &assemble_options(),
        )
        .expect("success");
        assert_eq!(zero.stations[0].scheduled_arrival, None);

        let zero_string = map_paytm_payload(
            &json!({
                "status": { "result": "success" },
                "body": {
                    "stations": [{ "stationCode": "ADI", "arrivalTime": "22:40", "dayCount": "0" }],
                    "current_station": null,
                },
            }),
            &assemble_options(),
        )
        .expect("success");
        assert_eq!(
            zero_string.stations[0].scheduled_arrival.as_deref(),
            Some("22:40")
        );
        assert_eq!(zero_string.stations[0].day, 0);
    }

    #[test]
    fn adapts_a_not_found_payload_to_not_found() {
        let err = map_paytm_payload(
            &json!({ "error": true, "status": { "result": "failure" } }),
            &assemble_options(),
        )
        .expect_err("must fail");
        assert!(matches!(
            err,
            ProviderError::NotFound { provider } if provider == "paytm"
        ));
    }

    #[test]
    fn adapts_an_ambiguous_error_to_upstream() {
        let err = map_paytm_payload(
            &json!({ "error": true, "status": { "result": "service_unavailable" } }),
            &assemble_options(),
        )
        .expect_err("must fail");
        assert_eq!(
            upstream_message(err),
            r#"Paytm reported an unsuccessful result: "service_unavailable""#
        );
    }

    #[test]
    fn adapts_a_missing_body_to_upstream() {
        let err = map_paytm_payload(
            &json!({ "status": { "result": "success" }, "body": null }),
            &assemble_options(),
        )
        .expect_err("must fail");
        assert_eq!(
            upstream_message(err),
            "Unexpected response shape from Paytm"
        );
    }
}

mod provider {
    use super::*;

    #[tokio::test]
    async fn builds_the_expected_url_query_and_headers() {
        let transport = mock_serving(happy_raw());
        let provider = create_paytm_provider(transport.clone());

        let status = provider
            .fetch_train_status(
                TRAIN_NUMBER,
                DEPARTURE_DATE,
                &ProviderFetchOptions::default(),
                None,
            )
            .await
            .expect("success");
        assert_eq!(status.current_station_code.as_deref(), Some("NDLS"));

        let requests = transport.requests();
        assert_eq!(requests.len(), 1);
        let url = url::Url::parse(&requests[0].url).expect("valid URL");
        assert_eq!(
            format!("{}{}", url.origin().ascii_serialization(), url.path()),
            STATUS_URL
        );
        let pairs: BTreeMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(
            pairs.get("train_number").map(String::as_str),
            Some(TRAIN_NUMBER)
        );
        assert_eq!(
            pairs.get("departure_date").map(String::as_str),
            Some(DEPARTURE_DATE)
        );
        assert_eq!(pairs.get("isH5").map(String::as_str), Some("true"));
        assert_eq!(pairs.get("client").map(String::as_str), Some("web"));
        assert_eq!(
            pairs.get("deviceIdentifier").map(String::as_str),
            Some("Mozilla Firefox-150.0.0.0")
        );
        assert_eq!(
            requests[0].header_value("User-Agent"),
            Some("Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36")
        );
        assert_eq!(requests[0].header_value("Accept"), Some("application/json"));
    }

    #[tokio::test]
    async fn factory_exposes_the_provider_contract() {
        let provider = create_paytm_provider(failing(FailKind::Network));
        assert_eq!(provider.name(), "paytm");
        assert!(provider.enabled());
    }

    #[tokio::test]
    async fn maps_a_not_found_payload_to_not_found() {
        let transport = mock_serving(json!({ "error": true, "status": { "result": "failure" } }));
        let err = fetch_upstream(Arc::clone(&transport) as Arc<dyn HttpTransport>).await;
        assert!(matches!(
            err,
            ProviderError::NotFound { provider } if provider == "paytm"
        ));
    }

    #[tokio::test]
    async fn maps_an_ambiguous_payload_to_upstream() {
        let transport =
            mock_serving(json!({ "error": true, "status": { "result": "service_unavailable" } }));
        let err = fetch_upstream(Arc::clone(&transport) as Arc<dyn HttpTransport>).await;
        assert_eq!(
            upstream_message(err),
            r#"Paytm reported an unsuccessful result: "service_unavailable""#
        );
    }

    #[tokio::test]
    async fn reports_a_timeout_as_an_upstream_network_error() {
        let err = fetch_upstream(failing(FailKind::Timeout)).await;
        assert_eq!(upstream_message(err), "Network error reaching paytm");
    }

    #[tokio::test]
    async fn reports_a_network_failure_as_an_upstream_network_error() {
        let err = fetch_upstream(failing(FailKind::Network)).await;
        assert_eq!(upstream_message(err), "Network error reaching paytm");
    }

    #[tokio::test]
    async fn reports_a_redirect_limit_as_an_upstream_network_error() {
        let err = fetch_upstream(failing(FailKind::RedirectLimit)).await;
        assert_eq!(upstream_message(err), "Network error reaching paytm");
    }

    #[tokio::test]
    async fn reports_an_unclassified_transport_error_as_an_upstream_network_error() {
        let err = fetch_upstream(failing(FailKind::Other)).await;
        assert_eq!(upstream_message(err), "Network error reaching paytm");
    }

    #[tokio::test]
    async fn reports_an_abort_mid_flight_as_an_upstream_network_error() {
        let mut transport = MockTransport::new();
        transport.push_delayed(STATUS_PATH, Duration::from_secs(30), 200, "{}");
        let transport = Arc::new(transport);
        let provider = create_paytm_provider(transport.clone());

        let signal = AbortSignal::new();
        let options = ProviderFetchOptions {
            abort: Some(signal.clone()),
        };
        let handle = tokio::spawn(async move {
            provider
                .fetch_train_status(TRAIN_NUMBER, DEPARTURE_DATE, &options, None)
                .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        signal.abort();

        let err = handle.await.expect("join").expect_err("must abort");
        assert_eq!(upstream_message(err), "Network error reaching paytm");
    }

    #[tokio::test]
    async fn reports_a_non_200_status_with_the_status_in_the_message() {
        let mut transport = MockTransport::new();
        transport.push(STATUS_PATH, 500, "boom");
        let err = fetch_upstream(Arc::new(transport)).await;
        assert_eq!(upstream_message(err), "paytm returned status 500");
    }

    #[tokio::test]
    async fn does_not_special_case_404() {
        let mut transport = MockTransport::new();
        transport.push(STATUS_PATH, 404, "not found");
        let err = fetch_upstream(Arc::new(transport)).await;
        assert_eq!(upstream_message(err), "paytm returned status 404");
    }

    #[tokio::test]
    async fn reports_an_oversized_body_as_an_upstream_error() {
        let mut transport = MockTransport::new().with_max_response_bytes(16);
        transport.push(STATUS_PATH, 200, vec![b'x'; 1024]);
        let err = fetch_upstream(Arc::new(transport)).await;
        assert_eq!(upstream_message(err), "paytm response too large");
    }

    #[tokio::test]
    async fn reports_a_non_json_body_as_an_upstream_error() {
        let mut transport = MockTransport::new();
        transport.push(STATUS_PATH, 200, "<html>oops</html>");
        let err = fetch_upstream(Arc::new(transport)).await;
        assert_eq!(upstream_message(err), "Invalid response body from paytm");
    }
}
