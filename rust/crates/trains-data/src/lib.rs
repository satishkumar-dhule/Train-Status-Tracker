//! Rail Saarthi — `tt-trains-data` crate.
//!
//! Seam: static train dataset, fuzzy search, time/date helpers, and the
//! fail-open NTES train-list fetcher. Ported 1:1 from
//! `lib/trains-data/src/*` (the TS modules' test files are the golden spec).
//!
//! Deep module: the public surface below is small; the implementation lives in
//! private submodules (`search`, `query`, `time`, `text`, `fetcher`, `data`).
//!
//! Naming mirrors the TS exports (snake_case): `searchTrains` -> `search_trains`,
//! `calcDelay` -> `calc_delay`, and so on.

mod data;
mod fetcher;
mod query;
mod search;
mod text;
mod time;

// search.ts / index.ts
pub use search::{Score, TrainEntry, score_train, search_trains, search_trains_bundled, TRAINS};

// query.ts
pub use query::{
    MIN_QUERY_LENGTH, find_train_by_number, matches_train_name, matches_train_number,
    normalize_train_number, unique_by_number,
};

// time.ts
pub use time::{
    LocalDate, calc_delay, format_duration, format_short_date, from_api_date, get_date_window,
    get_upcoming_dates, is_valid_api_date, is_valid_departure_date, pick_default_run_date,
    to_api_date, to_minutes,
};

// text.ts
pub use text::strip_html;

// fetcher.ts
pub use fetcher::{
    HttpTransport, HttpResponse, TrainDataFetcher, TrainDataFetcherOptions, UreqTransport,
    build_train_data_url, create_train_data_fetcher, parse_train_data_js,
    TRAIN_DATA_DEFAULT_MAX_REDIRECTS, TRAIN_DATA_DEFAULT_MAX_RESPONSE_BYTES,
    TRAIN_DATA_DEFAULT_TIMEOUT_MS, TRAIN_DATA_DEFAULT_TTL_MS, TRAIN_DATA_DEFAULT_URL,
    TRAIN_DATA_VERSION_PARAM,
};
