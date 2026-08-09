//! Golden wire-type round-trip tests.
//!
//! Every fixture literal below is copied verbatim from the TypeScript test
//! suite (`artifacts/api-server/src/routes/*.test.ts`,
//! `artifacts/api-server/src/lib/train-status-mapper.test.ts`) or from the
//! OpenAPI spec. The TS server emits *explicit* `null` for nullish fields, so
//! a parsed struct must re-serialize those fields as `null` too.

use tt_contract::{
    AtStationResponse, BetweenStationsResponse, ErrorResponse, HealthStatus, HealthStatusRedis,
    PnrStatusResponse, ScheduleStation, StationStatus, StationTrain, TrainAlert,
    TrainAlertsResponse, TrainCatalogResponse, TrainEntry, TrainRunsResponse,
    TrainScheduleResponse, TrainSearchResponse, TrainStatusResponse,
};

/// Parse a compact JSON literal into `T`, re-serialize it, and assert the
/// bytes are identical. Only valid for canonical fixtures that carry *every*
/// field (nullish ones as explicit `null`) written in declaration order.
fn round_trip_json<T>(json: &str) -> String
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let parsed: T = serde_json::from_str(json).expect("deserialize should succeed");
    serde_json::to_string(&parsed).expect("serialize should succeed")
}

mod health_status {
    use super::*;

    // Mirrors `routes/health.ts`: every field present, `version` explicit
    // `null` when SERVICE_VERSION is unset.
    const WITH_NULL_VERSION: &str = r#"{"status":"ok","redis":"up","uptime_seconds":42,"version":null,"timestamp":"2026-08-06T10:00:00.000Z"}"#;

    const WITH_VERSION: &str = r#"{"status":"ok","redis":"disabled","uptime_seconds":7,"version":"0.1.0","timestamp":"2026-08-06T10:00:00.000Z"}"#;

    #[test]
    fn serializes_the_health_route_payload_with_null_version() {
        let h = HealthStatus {
            status: "ok".into(),
            redis: Some(HealthStatusRedis::Up),
            uptime_seconds: Some(42),
            version: None,
            timestamp: Some("2026-08-06T10:00:00.000Z".into()),
        };
        let out = serde_json::to_string(&h).unwrap();
        assert_eq!(out, WITH_NULL_VERSION);
    }

    #[test]
    fn round_trips_with_explicit_null_version() {
        let s = round_trip_json::<HealthStatus>(WITH_NULL_VERSION);
        assert_eq!(s, WITH_NULL_VERSION);
    }

    #[test]
    fn round_trips_with_a_string_version() {
        let s = round_trip_json::<HealthStatus>(WITH_VERSION);
        assert_eq!(s, WITH_VERSION);
    }

    #[test]
    fn null_version_round_trips_to_none() {
        let h: HealthStatus = serde_json::from_str(WITH_NULL_VERSION).unwrap();
        assert_eq!(h.version, None);
        assert_eq!(h.redis, Some(HealthStatusRedis::Up));
    }

    #[test]
    fn optional_fields_may_be_absent_on_input() {
        let h: HealthStatus = serde_json::from_str(r#"{"status":"ok"}"#).unwrap();
        assert_eq!(h.redis, None);
        assert_eq!(h.uptime_seconds, None);
        assert_eq!(h.version, None);
        assert_eq!(h.timestamp, None);
    }

    #[test]
    fn required_status_is_mandatory() {
        assert!(serde_json::from_str::<HealthStatus>(r#"{}"#).is_err());
    }

    #[test]
    fn field_order_does_not_matter_for_json_equality() {
        let canonical: HealthStatus = serde_json::from_str(WITH_NULL_VERSION).unwrap();
        let reordered: HealthStatus = serde_json::from_str(concat!(
            r#"{"timestamp":"2026-08-06T10:00:00.000Z","#,
            r#""version":null,"uptime_seconds":42,"redis":"up","status":"ok"}"#,
        ))
        .unwrap();
        assert_eq!(canonical, reordered);
    }
}

mod health_status_redis {
    use super::*;

    #[test]
    fn serializes_to_lowercase_wire_values() {
        assert_eq!(
            serde_json::to_string(&HealthStatusRedis::Up).unwrap(),
            r#""up""#
        );
        assert_eq!(
            serde_json::to_string(&HealthStatusRedis::Down).unwrap(),
            r#""down""#
        );
        assert_eq!(
            serde_json::to_string(&HealthStatusRedis::Disabled).unwrap(),
            r#""disabled""#
        );
    }

    #[test]
    fn deserializes_the_enum_values() {
        assert_eq!(
            serde_json::from_str::<HealthStatusRedis>(r#""up""#).unwrap(),
            HealthStatusRedis::Up
        );
        assert_eq!(
            serde_json::from_str::<HealthStatusRedis>(r#""down""#).unwrap(),
            HealthStatusRedis::Down
        );
        assert_eq!(
            serde_json::from_str::<HealthStatusRedis>(r#""disabled""#).unwrap(),
            HealthStatusRedis::Disabled
        );
        assert!(serde_json::from_str::<HealthStatusRedis>(r#""partial""#).is_err());
    }
}

mod error_response {
    use super::*;

    // From routes/trains.test.ts 404 payload.
    const FIXTURE: &str = r#"{"error":"Train not found or no data available"}"#;

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<ErrorResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn error_field_is_required() {
        assert!(serde_json::from_str::<ErrorResponse>(r#"{}"#).is_err());
    }
}

mod train_entry {
    use super::*;

    const FIXTURE: &str = r#"{"number":"22943","name":"Indore Intercity SF Express"}"#;

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<TrainEntry>(FIXTURE), FIXTURE);
    }

    #[test]
    fn both_fields_are_required() {
        assert!(serde_json::from_str::<TrainEntry>(r#"{"number":"22943"}"#).is_err());
        assert!(serde_json::from_str::<TrainEntry>(r#"{"name":"x"}"#).is_err());
    }
}

mod train_catalog_response {
    use super::*;

    // From routes/train-catalog.test.ts "fetches and returns the parsed NTES catalog".
    const FIXTURE: &str = concat!(
        r#"{"trains":["#,
        r#"{"number":"12001","name":"Bhopal Shatabdi Express"},"#,
        r#"{"number":"12002","name":"New Delhi Shatabdi Express"},"#,
        r#"{"number":"12951","name":"Mumbai Rajdhani Express"},"#,
        r#"{"number":"22943","name":"Indore Intercity SF Express"}"#,
        r#"]}"#,
    );

    #[test]
    fn round_trips_byte_identical() {
        let s = round_trip_json::<TrainCatalogResponse>(FIXTURE);
        assert_eq!(s, FIXTURE);
    }

    #[test]
    fn trains_is_required() {
        assert!(serde_json::from_str::<TrainCatalogResponse>(r#"{}"#).is_err());
    }
}

mod train_search_response {
    use super::*;

    // Derived from routes/train-catalog.test.ts search matches.
    const FIXTURE: &str = concat!(
        r#"{"results":["#,
        r#"{"number":"12001","name":"Bhopal Shatabdi Express"},"#,
        r#"{"number":"12951","name":"Mumbai Rajdhani Express"}"#,
        r#"]}"#,
    );

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<TrainSearchResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn results_is_required() {
        assert!(serde_json::from_str::<TrainSearchResponse>(r#"{}"#).is_err());
    }
}

mod train_runs_response {
    use super::*;

    // From routes/train-runs.test.ts "returns the last 3 runs plus the next run".
    const FIXTURE: &str =
        r#"{"train_number":"22943","runs":["20260727","20260730","20260803","20260806"]}"#;

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<TrainRunsResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn empty_runs_round_trip() {
        let f = r#"{"train_number":"88888","runs":[]}"#;
        assert_eq!(round_trip_json::<TrainRunsResponse>(f), f);
    }

    #[test]
    fn train_number_is_required() {
        assert!(serde_json::from_str::<TrainRunsResponse>(r#"{"runs":[]}"#).is_err());
    }
}

mod station_status {
    use super::*;

    // From lib/train-status-mapper.test.ts "maps a fully populated station".
    const FULL: &str = concat!(
        r#"{"station_code":"NDLS","station_name":"New Delhi","#,
        r#""scheduled_arrival":"08:00","actual_arrival":"08:20","#,
        r#""scheduled_departure":"08:05","actual_departure":"08:25","#,
        r#""delay_minutes":20,"distance_from_source":391,"#,
        r#""platform":"5","halt_minutes":5,"#,
        r#""has_departed":true,"is_current":true,"day":1}"#,
    );

    // From lib/train-status-mapper.test.ts "applies defaults for missing fields".
    const ALL_NULL: &str = concat!(
        r#"{"station_code":"","station_name":"","#,
        r#""scheduled_arrival":null,"actual_arrival":null,"#,
        r#""scheduled_departure":null,"actual_departure":null,"#,
        r#""delay_minutes":null,"distance_from_source":null,"#,
        r#""platform":null,"halt_minutes":null,"#,
        r#""has_departed":false,"is_current":false,"day":1}"#,
    );

    #[test]
    fn fully_populated_round_trips_byte_identical() {
        assert_eq!(round_trip_json::<StationStatus>(FULL), FULL);
    }

    #[test]
    fn all_null_round_trips_byte_identical() {
        assert_eq!(round_trip_json::<StationStatus>(ALL_NULL), ALL_NULL);
    }

    #[test]
    fn explicit_nulls_deserialize_to_none() {
        let s: StationStatus = serde_json::from_str(ALL_NULL).unwrap();
        assert_eq!(s.scheduled_arrival, None);
        assert_eq!(s.actual_arrival, None);
        assert_eq!(s.delay_minutes, None);
        assert_eq!(s.distance_from_source, None);
        assert_eq!(s.platform, None);
        assert_eq!(s.halt_minutes, None);
    }

    #[test]
    fn required_fields_are_mandatory() {
        // `has_departed` is required by the spec; dropping it must fail even
        // though every nullable field is present as `null`.
        let missing_required = concat!(
            r#"{"station_code":"NDLS","station_name":"New Delhi","#,
            r#""scheduled_arrival":null,"actual_arrival":null,"#,
            r#""scheduled_departure":null,"actual_departure":null,"#,
            r#""delay_minutes":null,"distance_from_source":null,"#,
            r#""platform":null,"halt_minutes":null,"#,
            r#""is_current":true,"day":1}"#,
        );
        assert!(serde_json::from_str::<StationStatus>(missing_required).is_err());
    }

    #[test]
    fn zero_values_are_not_nulled() {
        let f = concat!(
            r#"{"station_code":"ADI","station_name":"Ahmedabad Jn","#,
            r#""scheduled_arrival":null,"actual_arrival":null,"#,
            r#""scheduled_departure":"23:00","actual_departure":"23:00","#,
            r#""delay_minutes":0,"distance_from_source":0,"#,
            r#""platform":null,"halt_minutes":null,"#,
            r#""has_departed":true,"is_current":false,"day":1}"#,
        );
        let s: StationStatus = serde_json::from_str(f).unwrap();
        assert_eq!(s.delay_minutes, Some(0));
        assert_eq!(s.distance_from_source, Some(0));
        assert_eq!(round_trip_json::<StationStatus>(f), f);
    }
}

mod train_status_response {
    use super::*;

    // From lib/train-status-mapper.test.ts "handles an empty stations array".
    const EMPTY: &str = concat!(
        r#"{"train_number":"12301","train_name":"Train 12301","#,
        r#""departure_date":"20260805","#,
        r#""source_station_code":"","source_station_name":"","#,
        r#""destination_station_code":"","destination_station_name":"","#,
        r#""current_station_code":null,"current_station_name":null,"#,
        r#""current_delay_minutes":null,"status_message":null,"last_updated":null,"#,
        r#""stations":[]}"#,
    );

    // From lib/train-status-mapper.test.ts "maps the full status response",
    // with fully populated stations.
    const FULL: &str = concat!(
        r#"{"train_number":"12301","train_name":"Howrah Rajdhani Express","#,
        r#""departure_date":"20260805","#,
        r#""source_station_code":"NDLS","source_station_name":"New Delhi","#,
        r#""destination_station_code":"CNB","destination_station_name":"Kanpur","#,
        r#""current_station_code":"NDLS","current_station_name":"New Delhi","#,
        r#""current_delay_minutes":20,"status_message":"Running on time","#,
        r#""last_updated":"2026-08-05T12:00:00Z","#,
        r#""stations":[{"station_code":"NDLS","station_name":"New Delhi","#,
        r#""scheduled_arrival":"08:00","actual_arrival":"08:20","#,
        r#""scheduled_departure":"08:05","actual_departure":"08:25","#,
        r#""delay_minutes":20,"distance_from_source":391,"#,
        r#""platform":"5","halt_minutes":5,"#,
        r#""has_departed":true,"is_current":true,"day":1},"#,
        r#"{"station_code":"CNB","station_name":"Kanpur","#,
        r#""scheduled_arrival":"10:50","actual_arrival":"11:10","#,
        r#""scheduled_departure":"10:55","actual_departure":null,"#,
        r#""delay_minutes":20,"distance_from_source":1206,"#,
        r#""platform":"2","halt_minutes":5,"#,
        r#""has_departed":false,"is_current":false,"day":2}]}"#,
    );

    #[test]
    fn empty_stations_round_trips_byte_identical() {
        assert_eq!(round_trip_json::<TrainStatusResponse>(EMPTY), EMPTY);
    }

    #[test]
    fn full_response_round_trips_byte_identical() {
        let s = round_trip_json::<TrainStatusResponse>(FULL);
        assert_eq!(s, FULL);
    }

    #[test]
    fn explicit_nulls_deserialize_to_none() {
        let t: TrainStatusResponse = serde_json::from_str(EMPTY).unwrap();
        assert_eq!(t.current_station_code, None);
        assert_eq!(t.current_station_name, None);
        assert_eq!(t.current_delay_minutes, None);
        assert_eq!(t.status_message, None);
        assert_eq!(t.last_updated, None);
        assert!(t.stations.is_empty());
    }

    #[test]
    fn required_fields_are_mandatory() {
        assert!(serde_json::from_str::<TrainStatusResponse>(r#"{}"#).is_err());
    }

    // From routes/trains.redis.test.ts `cachedPayload`: a real cached response
    // whose stations omit the optional `platform`/`halt_minutes` keys. The TS
    // mapper always emits them as explicit `null`, so a round-trip must fill
    // the missing optionals back in as `null` and reproduce this canonical
    // string byte-identically.
    #[test]
    fn redis_cached_payload_round_trips_with_explicit_nulls_filled_in() {
        const PAYLOAD: &str = concat!(
            r#"{"train_number":"22943","train_name":"Indore Intercity SF Express","#,
            r#""departure_date":"20260802","#,
            r#""source_station_code":"INDB","source_station_name":"Indore Jn BG","#,
            r#""destination_station_code":"NDLS","destination_station_name":"New Delhi","#,
            r#""current_station_code":"NDLS","current_station_name":"New Delhi","#,
            r#""current_delay_minutes":0,"status_message":"Running on time","#,
            r#""last_updated":"2026-08-02T08:20:00+05:30","#,
            r#""stations":["#,
            r#"{"station_code":"ADI","station_name":"Ahmedabad Jn","has_departed":true,"#,
            r#""is_current":false,"day":1,"scheduled_arrival":null,"scheduled_departure":"23:00","#,
            r#""actual_arrival":null,"actual_departure":"23:00","delay_minutes":0,"distance_from_source":0},"#,
            r#"{"station_code":"NDLS","station_name":"New Delhi","has_departed":true,"#,
            r#""is_current":true,"day":2,"scheduled_arrival":"08:05","scheduled_departure":null,"#,
            r#""actual_arrival":"08:40","actual_departure":null,"delay_minutes":35,"distance_from_source":938}"#,
            r#"]}"#,
        );
        const EXPECTED: &str = concat!(
            r#"{"train_number":"22943","train_name":"Indore Intercity SF Express","#,
            r#""departure_date":"20260802","#,
            r#""source_station_code":"INDB","source_station_name":"Indore Jn BG","#,
            r#""destination_station_code":"NDLS","destination_station_name":"New Delhi","#,
            r#""current_station_code":"NDLS","current_station_name":"New Delhi","#,
            r#""current_delay_minutes":0,"status_message":"Running on time","#,
            r#""last_updated":"2026-08-02T08:20:00+05:30","#,
            r#""stations":["#,
            r#"{"station_code":"ADI","station_name":"Ahmedabad Jn","scheduled_arrival":null,"#,
            r#""actual_arrival":null,"scheduled_departure":"23:00","actual_departure":"23:00","#,
            r#""delay_minutes":0,"distance_from_source":0,"platform":null,"halt_minutes":null,"#,
            r#""has_departed":true,"is_current":false,"day":1},"#,
            r#"{"station_code":"NDLS","station_name":"New Delhi","scheduled_arrival":"08:05","#,
            r#""actual_arrival":"08:40","scheduled_departure":null,"actual_departure":null,"#,
            r#""delay_minutes":35,"distance_from_source":938,"platform":null,"halt_minutes":null,"#,
            r#""has_departed":true,"is_current":true,"day":2}"#,
            r#"]}"#,
        );
        let out = round_trip_json::<TrainStatusResponse>(PAYLOAD);
        assert_eq!(out, EXPECTED);
    }
}

mod train_schedule_response {
    use super::*;

    // Compact canonical fixture with explicit nulls, in declaration order.
    const FIXTURE: &str = concat!(
        r#"{"train_number":"22943","train_name":null,"departure_date":"20260802","#,
        r#""source_station_code":"ADI","source_station_name":"Ahmedabad Jn","#,
        r#""destination_station_code":"CNB","destination_station_name":"Kanpur Central","#,
        r#""stations":[{"station_code":"ADI","station_name":"Ahmedabad Jn","#,
        r#""arrival_time":null,"departure_time":"23:00","halt_minutes":20,"#,
        r#""distance_from_source":0,"platform":null,"day":1},"#,
        r#"{"station_code":"CNB","station_name":"Kanpur Central","#,
        r#""arrival_time":"10:50","departure_time":null,"halt_minutes":null,"#,
        r#""distance_from_source":1256,"platform":"2","day":2}]}"#,
    );

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<TrainScheduleResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn explicit_nulls_deserialize_to_none() {
        let s: TrainScheduleResponse = serde_json::from_str(FIXTURE).unwrap();
        assert_eq!(s.train_name, None);
        assert_eq!(s.stations[0].arrival_time, None);
        assert_eq!(s.stations[1].halt_minutes, None);
    }

    #[test]
    fn schedule_station_and_required_fields_are_mandatory() {
        assert!(serde_json::from_str::<ScheduleStation>(r#"{}"#).is_err());
        assert!(serde_json::from_str::<TrainScheduleResponse>(r#"{}"#).is_err());
    }
}

mod between_stations_response {
    use super::*;

    const FIXTURE: &str = concat!(
        r#"{"from_station_code":"ADI","to_station_code":"NDLS","departure_date":"20260802","#,
        r#""trains":[{"train_number":"22943","train_name":"Indore Intercity SF Express","#,
        r#""from_station_code":"ADI","to_station_code":"NDLS","#,
        r#""departure_time":"23:00","arrival_time":"08:05","day":1,"#,
        r#""journey_time_minutes":545,"days_run":["Mon","Wed","Sat"]}]}"#,
    );

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<BetweenStationsResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn empty_trains_round_trip() {
        let f = r#"{"from_station_code":"ADI","to_station_code":"NDLS","departure_date":"20260802","trains":[]}"#;
        assert_eq!(round_trip_json::<BetweenStationsResponse>(f), f);
    }

    #[test]
    fn required_fields_are_mandatory() {
        assert!(serde_json::from_str::<BetweenStationsResponse>(r#"{}"#).is_err());
    }
}

mod at_station_response {
    use super::*;

    const FIXTURE: &str = concat!(
        r#"{"station_code":"ADI","station_name":"Ahmedabad Jn","date":"20260802","#,
        r#""trains":[{"train_number":"22943","train_name":"Indore Intercity SF Express","#,
        r#""direction":"down","scheduled_arrival":null,"scheduled_departure":"23:00","#,
        r#""day":1,"from_station_code":"INDB","to_station_code":"NDLS"}]}"#,
    );

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<AtStationResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn station_train_required_fields_are_mandatory() {
        assert!(serde_json::from_str::<StationTrain>(r#"{}"#).is_err());
        assert!(serde_json::from_str::<AtStationResponse>(r#"{}"#).is_err());
    }
}

mod train_alerts_response {
    use super::*;

    const FIXTURE: &str = concat!(
        r#"{"train_number":"22943","alerts":["#,
        r#"{"kind":"reschedule","message":"Rescheduled by 2h","from_station_code":"ADI","#,
        r#""to_station_code":"NDLS","date":"20260805","created_at":null},"#,
        r#"{"kind":"delay","message":"Running late","from_station_code":null,"#,
        r#""to_station_code":null,"date":null,"created_at":null}]}"#,
    );

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<TrainAlertsResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn empty_alerts_round_trip() {
        let f = r#"{"train_number":"22943","alerts":[]}"#;
        assert_eq!(round_trip_json::<TrainAlertsResponse>(f), f);
        let t: TrainAlert = serde_json::from_str(
            r#"{"kind":"delay","message":"x","from_station_code":null,"to_station_code":null,"date":null,"created_at":null}"#,
        )
        .unwrap();
        assert_eq!(t.kind, "delay");
    }

    #[test]
    fn required_fields_are_mandatory() {
        assert!(serde_json::from_str::<TrainAlertsResponse>(r#"{}"#).is_err());
        assert!(serde_json::from_str::<TrainAlert>(r#"{}"#).is_err());
    }
}

mod pnr_status_response {
    use super::*;

    const FIXTURE: &str = concat!(
        r#"{"pnr":"2315455889","train_number":"22943","train_name":"Indore Intercity SF Express","#,
        r#""from_station_code":"INDB","to_station_code":"NDLS","boarding_station_code":"INDB","#,
        r#""booking_date":"20260720","journey_date":"20260802","travel_class":"SL","#,
        r#""chart_prepared":true,"#,
        r#""passengers":[{"serial":1,"current_status":"CNF","berth":"B1 42","coach":"B1"}],"#,
        r#""last_updated":"2026-08-02T08:20:00+05:30"}"#,
    );

    #[test]
    fn round_trips_byte_identical() {
        assert_eq!(round_trip_json::<PnrStatusResponse>(FIXTURE), FIXTURE);
    }

    #[test]
    fn chart_not_prepared_and_null_fields_round_trip() {
        let f = concat!(
            r#"{"pnr":"2315455889","train_number":null,"train_name":null,"#,
            r#""from_station_code":null,"to_station_code":null,"boarding_station_code":null,"#,
            r#""booking_date":null,"journey_date":null,"travel_class":null,"#,
            r#""chart_prepared":false,"passengers":[],"last_updated":null}"#,
        );
        let p: PnrStatusResponse = serde_json::from_str(f).unwrap();
        assert!(!p.chart_prepared);
        assert!(p.passengers.is_empty());
        assert_eq!(round_trip_json::<PnrStatusResponse>(f), f);
    }

    #[test]
    fn required_fields_are_mandatory() {
        assert!(serde_json::from_str::<PnrStatusResponse>(r#"{}"#).is_err());
    }
}
