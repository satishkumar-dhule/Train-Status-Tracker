//! Rail Saarthi — `tt-contract` crate.
//!
//! Seam: serde wire types + query-param validation (zod-coercion semantics).
//!
//! Deep module: keep the public surface in this file small and hide the
//! implementation in private submodules. The interface here is the test surface.

mod validate;
mod wire;

pub use validate::{
    is_valid_departure_date, is_valid_train_number, parse_search_limit, parse_search_q,
    SearchLimitError, SearchQueryError, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, SEARCH_LIMIT_MIN,
    SEARCH_Q_MAX_LENGTH,
};
pub use wire::{
    ErrorResponse, HealthStatus, HealthStatusRedis, StationStatus, TrainCatalogResponse,
    TrainEntry, TrainRunsResponse, TrainSearchResponse, TrainStatusResponse,
};
