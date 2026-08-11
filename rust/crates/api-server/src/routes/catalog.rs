//! `GET /api/trains` and `GET /api/trains/search` — train catalog lookup,
//! ported from `routes/train-catalog.ts` (backed by `lib/train-catalog.ts`,
//! whose fetcher is TTL-cached and fails open to the bundled dataset).
//!
//! `train_search` rejects missing and repeated params over the raw query
//! (so arrays can never be silently stringified), then validates `q` (trimmed,
//! max 64 UTF-16 code units) and the optional `limit` (coerced integer in
//! `1..=100`, default 10). An empty `q` is valid and simply matches nothing,
//! exactly like the reference's `searchTrains` short-circuit.

use axum::extract::{RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};

use tt_contract::{
    parse_search_limit, parse_search_q, ErrorResponse, SearchLimitError, SearchQueryError,
    TrainCatalogResponse, TrainEntry, TrainSearchResponse,
};
use tt_trains_data::TrainEntry as DataTrainEntry;

use crate::app::AppState;

const Q_ARRAY_MESSAGE: &str = "q: expected string, received array";
const LIMIT_ARRAY_MESSAGE: &str = "limit: expected number, received array";
const Q_TOO_LONG_MESSAGE: &str = "q: Invalid string: must contain at most 64 character(s)";
const LIMIT_NOT_INTEGER_MESSAGE: &str = "limit: Invalid input: expected integer, received float";
const LIMIT_OUT_OF_RANGE_MESSAGE: &str = "limit: Number must be at least 1 and at most 100";

/// `GET /api/trains` — the full parsed train catalog, `{ "trains": [...] }`.
pub(crate) async fn train_catalog(State(state): State<AppState>) -> impl IntoResponse {
    let trains = state
        .catalog
        .get_trains()
        .into_iter()
        .map(to_wire_entry)
        .collect();
    (StatusCode::OK, Json(TrainCatalogResponse { trains }))
}

/// `GET /api/trains/search` — duck-typed fuzzy search over the catalog.
pub(crate) async fn train_search(
    State(state): State<AppState>,
    RawQuery(raw_query): RawQuery,
) -> axum::response::Response {
    let pairs = url::form_urlencoded::parse(raw_query.unwrap_or_default().as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();

    let q_occurrences = pairs.iter().filter(|(k, _)| k == "q").count();
    if q_occurrences == 0 {
        return json_error(StatusCode::BAD_REQUEST, "q: Required".to_string());
    }
    if q_occurrences > 1 {
        return json_error(StatusCode::BAD_REQUEST, Q_ARRAY_MESSAGE.to_string());
    }
    let limit_occurrences = pairs.iter().filter(|(k, _)| k == "limit").count();
    if limit_occurrences > 1 {
        return json_error(StatusCode::BAD_REQUEST, LIMIT_ARRAY_MESSAGE.to_string());
    }

    let value = |key: &str| {
        pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let query = match parse_search_q(&value("q")) {
        Ok(query) => query,
        // Empty after trimming matches nothing — the reference's search
        // short-circuits with `[]` rather than rejecting.
        Err(SearchQueryError::Empty) => String::new(),
        Err(SearchQueryError::TooLong) => {
            return json_error(StatusCode::BAD_REQUEST, Q_TOO_LONG_MESSAGE.to_string());
        }
    };
    let limit = if limit_occurrences == 1 {
        Some(value("limit"))
    } else {
        None
    };
    let limit = match parse_search_limit(limit.as_deref()) {
        Ok(limit) => limit as usize,
        Err(SearchLimitError::NotAnInteger) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                LIMIT_NOT_INTEGER_MESSAGE.to_string(),
            );
        }
        Err(SearchLimitError::OutOfRange) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                LIMIT_OUT_OF_RANGE_MESSAGE.to_string(),
            );
        }
    };

    let results = state
        .catalog
        .search(&query, limit)
        .into_iter()
        .map(to_wire_entry)
        .collect();
    (StatusCode::OK, Json(TrainSearchResponse { results })).into_response()
}

fn to_wire_entry(entry: DataTrainEntry) -> TrainEntry {
    TrainEntry {
        number: entry.number,
        name: entry.name,
    }
}

fn json_error(status: StatusCode, message: String) -> axum::response::Response {
    (status, Json(ErrorResponse { error: message })).into_response()
}
