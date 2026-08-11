//! Normalized, provider-agnostic types mirroring `train-status-mapper.ts`.

use serde::{Deserialize, Serialize};

/// A normalized train status station (the shared contract adapters produce).
///
/// Every nullable field is `Option<T>` and serializes as explicit JSON `null`
/// when absent, matching the TS mapper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MappedStation {
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

/// Full train running status (the contract failover + routes consume). Serde
/// derives so a cache layer can store it (L2 Redis) without wire round-trips.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MappedStatus {
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
    /// The data source ("gateway") that served this status (e.g. "paytm",
    /// "goibibo"). Blank until the orchestrator stamps the serving provider.
    pub provider: String,
    pub stations: Vec<MappedStation>,
}

/// Context needed to render a human-readable train name on unknown trains.
#[derive(Debug, Clone, PartialEq)]
pub struct KnownTrain {
    pub number: String,
    pub name: String,
}
