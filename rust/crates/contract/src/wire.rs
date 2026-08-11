use serde::{Deserialize, Serialize};

/// Readiness payload. Mirrors `GET /healthz` (`routes/health.ts`): the
/// process always reports `status`, and dependency state is per-check.
/// Nullish fields serialize as explicit `null` (no `skip_serializing_if`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,
    pub redis: Option<HealthStatusRedis>,
    pub uptime_seconds: Option<i64>,
    pub version: Option<String>,
    pub timestamp: Option<String>,
}

/// Shared Redis cache availability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatusRedis {
    Up,
    Down,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// A single train in the catalog (number + name).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainEntry {
    pub number: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainCatalogResponse {
    pub trains: Vec<TrainEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainSearchResponse {
    pub results: Vec<TrainEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainRunsResponse {
    pub train_number: String,
    pub runs: Vec<String>,
}

/// Running status at a single station.
///
/// Every nullable field is `Option<T>` and, when absent, serializes as
/// explicit JSON `null` — the TS mapper emits every key with `null` for
/// nullish values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StationStatus {
    pub station_code: String,
    pub station_name: String,
    pub scheduled_arrival: Option<String>,
    pub actual_arrival: Option<String>,
    pub scheduled_departure: Option<String>,
    pub actual_departure: Option<String>,
    pub delay_minutes: Option<i64>,
    pub distance_from_source: Option<i64>,
    pub platform: Option<String>,
    pub halt_minutes: Option<i64>,
    pub has_departed: bool,
    pub is_current: bool,
    pub day: i64,
}

/// Full train running status.
///
/// All timestamps are ISO-8601 strings kept as pass-through bytes (`String`,
/// not chrono) so responses stay byte-identical to the TS server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrainStatusResponse {
    pub train_number: String,
    pub train_name: String,
    pub departure_date: String,
    pub source_station_code: String,
    pub source_station_name: String,
    pub destination_station_code: String,
    pub destination_station_name: String,
    pub current_station_code: Option<String>,
    pub current_station_name: Option<String>,
    pub current_delay_minutes: Option<i64>,
    pub status_message: Option<String>,
    pub last_updated: Option<String>,
    pub provider: String,
    pub stations: Vec<StationStatus>,
}

/// A single station in a static timetable (no live fields).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScheduleStation {
    pub station_code: String,
    pub station_name: String,
    pub arrival_time: Option<String>,
    pub departure_time: Option<String>,
    pub halt_minutes: Option<i64>,
    pub distance_from_source: Option<i64>,
    pub platform: Option<String>,
    pub day: i64,
}

/// `GET /api/trains/schedule` — the fixed station-by-station timetable for a
/// train on a given departure date. Live data is absent; every nullable field
/// serializes as explicit JSON `null`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrainScheduleResponse {
    pub train_number: String,
    pub train_name: Option<String>,
    pub departure_date: String,
    pub source_station_code: String,
    pub source_station_name: String,
    pub destination_station_code: String,
    pub destination_station_name: String,
    pub stations: Vec<ScheduleStation>,
}

/// A train running between the two queried stations, as seen from the source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BetweenTrain {
    pub train_number: String,
    pub train_name: String,
    pub from_station_code: String,
    pub to_station_code: String,
    pub departure_time: Option<String>,
    pub arrival_time: Option<String>,
    pub day: i64,
    pub journey_time_minutes: Option<i64>,
    pub days_run: Vec<String>,
}

/// `GET /api/trains/between` — trains that run between two stations on a date.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BetweenStationsResponse {
    pub from_station_code: String,
    pub to_station_code: String,
    pub departure_date: String,
    pub trains: Vec<BetweenTrain>,
}

/// A train halting at a queried station on a given date.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StationTrain {
    pub train_number: String,
    pub train_name: String,
    pub direction: String,
    pub scheduled_arrival: Option<String>,
    pub scheduled_departure: Option<String>,
    pub day: i64,
    pub from_station_code: String,
    pub to_station_code: String,
}

/// `GET /api/trains/station` — trains expected at a station on a date.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AtStationResponse {
    pub station_code: String,
    pub station_name: String,
    pub date: String,
    pub trains: Vec<StationTrain>,
}

/// A single disruption/notice attached to a train.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrainAlert {
    pub kind: String,
    pub message: String,
    pub from_station_code: Option<String>,
    pub to_station_code: Option<String>,
    pub date: Option<String>,
    pub created_at: Option<String>,
}

/// `GET /api/trains/alerts` — disruptions for a train. `alerts` is always
/// present and empty when the provider reports nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrainAlertsResponse {
    pub train_number: String,
    pub alerts: Vec<TrainAlert>,
}

/// A single passenger on a PNR.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PnrPassenger {
    pub serial: i64,
    pub current_status: String,
    pub berth: Option<String>,
    pub coach: Option<String>,
}

/// `GET /api/trains/pnr` — booking status for a 10-digit PNR.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PnrStatusResponse {
    pub pnr: String,
    pub train_number: Option<String>,
    pub train_name: Option<String>,
    pub from_station_code: Option<String>,
    pub to_station_code: Option<String>,
    pub boarding_station_code: Option<String>,
    pub booking_date: Option<String>,
    pub journey_date: Option<String>,
    pub travel_class: Option<String>,
    pub chart_prepared: bool,
    pub passengers: Vec<PnrPassenger>,
    pub last_updated: Option<String>,
}
