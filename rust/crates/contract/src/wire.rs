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
    pub stations: Vec<StationStatus>,
}
