//! Row-based normalization, ported 1:1 from `providers/normalize.ts`.
//!
//! This is the DRY seam that keeps every upstream behind a single
//! normalization path: adapters translate their payloads into
//! [`ProviderStationRow`]s and [`assemble_mapped_status`] builds the shared
//! [`MappedStatus`] contract.

use crate::types::{KnownTrain, MappedStation, MappedStatus};
use tt_trains_data::{calc_delay, strip_html};

/// Normalized, provider-agnostic station row. Adapters translate their own
/// payloads into this shape; [`to_mapped_station`] / [`assemble_mapped_status`]
/// then turn rows into the shared [`MappedStatus`] contract.
#[derive(Debug, Clone, Default)]
pub struct ProviderStationRow {
    pub station_code: String,
    pub station_name: String,
    pub scheduled_arrival: Option<String>,
    pub actual_arrival: Option<String>,
    pub scheduled_departure: Option<String>,
    pub actual_departure: Option<String>,
    /// Explicit "already departed" flag when the upstream tells us directly.
    /// When absent it is inferred positionally (rows before the current
    /// station are departed; the current station is departed once it has an
    /// actual departure time).
    pub has_departed: Option<bool>,
    pub delay_minutes: Option<i64>,
    pub distance: Option<i64>,
    pub platform: Option<String>,
    pub halt_minutes: Option<i64>,
    pub day: Option<i64>,
}

/// Options threaded through [`assemble_mapped_status`].
#[derive(Debug, Clone, Default)]
pub struct AssembleOptions {
    pub train_number: String,
    pub departure_date: String,
    pub known_train: Option<KnownTrain>,
    /// Code of the station the train is currently at/past, if known.
    pub current_station_code: Option<String>,
    pub status_message: Option<String>,
    pub last_updated: Option<String>,
}

/// 1-based serial of `current_station_code` within the row list, else 0.
pub fn compute_row_current_serial(
    rows: &[ProviderStationRow],
    current_station_code: Option<&str>,
) -> i64 {
    let Some(code) = current_station_code else {
        return 0;
    };
    match rows.iter().position(|row| row.station_code == code) {
        Some(index) => index as i64 + 1,
        None => 0,
    }
}

/// Turn one normalized row into a [`MappedStation`].
pub fn to_mapped_station(
    row: &ProviderStationRow,
    row_index: i64,
    current_station_code: Option<&str>,
    current_serial: i64,
) -> MappedStation {
    let is_current = Some(row.station_code.as_str()) == current_station_code;
    let serial = row_index + 1;
    let has_departed = row.has_departed.unwrap_or_else(|| {
        serial < current_serial || (is_current && row.actual_departure.is_some())
    });

    let scheduled_arrival = row.scheduled_arrival.clone();
    let scheduled_departure = row.scheduled_departure.clone();
    let distance = row.distance;

    let delay_minutes = match row.delay_minutes {
        Some(delay) => Some(delay),
        None => {
            calc_delay(scheduled_arrival.as_deref(), row.actual_arrival.as_deref()).map(i64::from)
        }
    };

    MappedStation {
        station_code: row.station_code.clone(),
        station_name: row.station_name.clone(),
        scheduled_arrival,
        actual_arrival: row.actual_arrival.clone(),
        scheduled_departure,
        actual_departure: row.actual_departure.clone(),
        delay_minutes,
        distance_from_source: distance,
        platform: row.platform.clone(),
        halt_minutes: row.halt_minutes,
        has_departed,
        is_current,
        day: row.day.unwrap_or(1),
    }
}

/// Turn normalized rows into the shared [`MappedStatus`] contract.
pub fn assemble_mapped_status(
    rows: &[ProviderStationRow],
    options: &AssembleOptions,
) -> MappedStatus {
    let current_station_code = options.current_station_code.as_deref();
    let current_serial = compute_row_current_serial(rows, current_station_code);
    let stations: Vec<MappedStation> = rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            to_mapped_station(row, index as i64, current_station_code, current_serial)
        })
        .collect();

    let current_station = stations.iter().find(|station| station.is_current);
    let first_station = stations.first();
    let last_station = stations.last();

    MappedStatus {
        train_number: options.train_number.clone(),
        train_name: options
            .known_train
            .as_ref()
            .map(|train| train.name.clone())
            .unwrap_or_else(|| format!("Train {}", options.train_number)),
        departure_date: options.departure_date.clone(),
        source_station_code: first_station
            .map(|station| station.station_code.clone())
            .unwrap_or_default(),
        source_station_name: first_station
            .map(|station| station.station_name.clone())
            .unwrap_or_default(),
        destination_station_code: last_station
            .map(|station| station.station_code.clone())
            .unwrap_or_default(),
        destination_station_name: last_station
            .map(|station| station.station_name.clone())
            .unwrap_or_default(),
        current_station_code: options.current_station_code.clone(),
        current_station_name: current_station.map(|station| station.station_name.clone()),
        current_delay_minutes: current_station.and_then(|station| station.delay_minutes),
        status_message: strip_html(options.status_message.as_deref()),
        last_updated: options.last_updated.clone(),
        // The assembler has no provider context; the orchestrator stamps the
        // serving provider name onto the result before it is cached/served.
        provider: String::new(),
        stations,
    }
}
