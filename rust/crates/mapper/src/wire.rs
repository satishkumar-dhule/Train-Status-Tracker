//! Conversion from the internal [`MappedStatus`] contract to the wire
//! response types in `tt-contract`.
//!
//! Reproduces the TS route's response construction (`GetTrainStatusResponse
//! .parse(upstream)` in `routes/trains.ts`) byte-for-byte: identical field
//! names and explicit `null` for every nullish field.

use crate::types::{MappedStation, MappedStatus};
use tt_contract::{StationStatus, TrainStatusResponse};

/// Convert a mapped status to the wire `TrainStatusResponse`.
pub fn to_wire_status(status: &MappedStatus) -> TrainStatusResponse {
    TrainStatusResponse {
        train_number: status.train_number.clone(),
        train_name: status.train_name.clone(),
        departure_date: status.departure_date.clone(),
        source_station_code: status.source_station_code.clone(),
        source_station_name: status.source_station_name.clone(),
        destination_station_code: status.destination_station_code.clone(),
        destination_station_name: status.destination_station_name.clone(),
        current_station_code: status.current_station_code.clone(),
        current_station_name: status.current_station_name.clone(),
        current_delay_minutes: status.current_delay_minutes,
        status_message: status.status_message.clone(),
        last_updated: status.last_updated.clone(),
        provider: status.provider.clone(),
        stations: status.stations.iter().map(to_wire_station).collect(),
    }
}

fn to_wire_station(station: &MappedStation) -> StationStatus {
    StationStatus {
        station_code: station.station_code.clone(),
        station_name: station.station_name.clone(),
        scheduled_arrival: station.scheduled_arrival.clone(),
        actual_arrival: station.actual_arrival.clone(),
        scheduled_departure: station.scheduled_departure.clone(),
        actual_departure: station.actual_departure.clone(),
        delay_minutes: station.delay_minutes,
        distance_from_source: station.distance_from_source,
        platform: station.platform.clone(),
        halt_minutes: station.halt_minutes,
        has_departed: station.has_departed,
        is_current: station.is_current,
        day: station.day,
    }
}
