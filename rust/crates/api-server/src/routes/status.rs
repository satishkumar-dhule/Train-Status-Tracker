//! `GET /api/trains/status` — running-status lookup, ported from
//! `routes/trains.ts` minus the caching/failover layers (later slices).
//!
//! Query validation mirrors the reference exactly: missing and repeated params
//! are rejected up front over the raw query (so arrays can never be silently
//! stringified), then the shape regexes, then the real-calendar gate, and only
//! then is the upstream called. Validation failures and upstream verdicts map
//! to the same status codes and bodies as the TypeScript server.

use axum::extract::{RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};

use tt_contract::{is_valid_departure_date, is_valid_train_number, ErrorResponse};
use tt_mapper::KnownTrain;
use tt_provider_core::{ProviderError, ProviderFetchOptions};
use tt_trains_data::{find_train_by_number, is_valid_api_date, TRAINS};

use crate::app::AppState;

/// `zod`-schema shape keys, in declaration order (first issue wins).
const SHAPE_KEYS: [&str; 2] = ["train_number", "departure_date"];

const TRAIN_NUMBER_REGEX_MESSAGE: &str = "train_number: Invalid input: must match ^\\d{5}$";
const DEPARTURE_DATE_REGEX_MESSAGE: &str = "departure_date: Invalid input: must match ^\\d{8}$";
const INVALID_CALENDAR_DATE_MESSAGE: &str =
    "departure_date must be a valid date in YYYYMMDD format";
const NOT_FOUND_MESSAGE: &str = "Train not found or no data available";
const UPSTREAM_MESSAGE: &str = "Could not reach train data provider";
const INTERNAL_ERROR_MESSAGE: &str = "Internal server error";

pub(crate) async fn train_status(
    State(state): State<AppState>,
    RawQuery(raw_query): RawQuery,
) -> axum::response::Response {
    // Keep the raw query as pairs so repeated params survive form-decoding
    // (Express 5 arrays), exactly like `req.query` in the reference.
    let pairs = url::form_urlencoded::parse(raw_query.unwrap_or_default().as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();

    for key in SHAPE_KEYS {
        let occurrences = pairs.iter().filter(|(k, _)| k == key).count();
        if occurrences == 0 {
            return json_error(StatusCode::BAD_REQUEST, format!("{key}: Required"));
        }
        if occurrences > 1 {
            return json_error(
                StatusCode::BAD_REQUEST,
                format!("{key}: expected string, received array"),
            );
        }
    }

    let value = |key: &str| {
        pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let train_number = value("train_number");
    let departure_date = value("departure_date");

    if !is_valid_train_number(&train_number) {
        return json_error(
            StatusCode::BAD_REQUEST,
            TRAIN_NUMBER_REGEX_MESSAGE.to_string(),
        );
    }
    if !is_valid_departure_date(&departure_date) {
        return json_error(
            StatusCode::BAD_REQUEST,
            DEPARTURE_DATE_REGEX_MESSAGE.to_string(),
        );
    }
    if !is_valid_api_date(&departure_date) {
        return json_error(
            StatusCode::BAD_REQUEST,
            INVALID_CALENDAR_DATE_MESSAGE.to_string(),
        );
    }

    let known_train = find_train_by_number(&TRAINS, &train_number).map(|train| KnownTrain {
        number: train.number.clone(),
        name: train.name.clone(),
    });

    match state
        .status_provider
        .fetch_train_status(
            &train_number,
            &departure_date,
            &ProviderFetchOptions::default(),
            known_train.as_ref(),
        )
        .await
    {
        Ok(mapped) => (StatusCode::OK, Json(tt_mapper::to_wire_status(&mapped))).into_response(),
        Err(ProviderError::NotFound { .. }) => {
            json_error(StatusCode::NOT_FOUND, NOT_FOUND_MESSAGE.to_string())
        }
        Err(ProviderError::Upstream { .. }) => {
            json_error(StatusCode::BAD_GATEWAY, UPSTREAM_MESSAGE.to_string())
        }
        Err(ProviderError::Program(_)) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            INTERNAL_ERROR_MESSAGE.to_string(),
        ),
    }
}

fn json_error(status: StatusCode, message: String) -> axum::response::Response {
    (status, Json(ErrorResponse { error: message })).into_response()
}
