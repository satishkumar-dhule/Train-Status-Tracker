//! Log level parsing, ported from `parseLogLevel` in `lib/logger.ts`.

use tracing::level_filters::LevelFilter;

/// A pino-compatible log level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    /// `trace` — most verbose.
    Trace,
    /// `debug`.
    Debug,
    /// `info` (default).
    Info,
    /// `warn`.
    Warn,
    /// `error` — also accepts pino's `fatal` (tracing has no level above error).
    Error,
    /// `silent` — disable all logging.
    Silent,
}

impl Level {
    /// Port of `parseLogLevel`: invalid, empty, or missing values fall back to
    /// [`Level::Info`]. Accepts every pino level name — `trace`, `debug`,
    /// `info`, `warn`, `error`, `fatal` (→ [`Level::Error`]) and `silent`
    /// (→ [`Level::Silent`]) — case-insensitively.
    pub fn parse(raw: Option<&str>) -> Level {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("trace") => Level::Trace,
            Some("debug") => Level::Debug,
            Some("info") => Level::Info,
            Some("warn") => Level::Warn,
            Some("error") | Some("fatal") => Level::Error,
            Some("silent") => Level::Silent,
            _ => Level::Info,
        }
    }

    /// The `tracing` filter for this level. [`Level::Silent`] maps to `OFF`.
    pub fn as_level_filter(self) -> LevelFilter {
        match self {
            Level::Trace => LevelFilter::TRACE,
            Level::Debug => LevelFilter::DEBUG,
            Level::Info => LevelFilter::INFO,
            Level::Warn => LevelFilter::WARN,
            Level::Error => LevelFilter::ERROR,
            Level::Silent => LevelFilter::OFF,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port of `parseLogLevel` in `lib/logger.test.ts`.
    #[test]
    fn accepts_every_known_pino_level() {
        assert_eq!(Level::parse(Some("trace")), Level::Trace);
        assert_eq!(Level::parse(Some("debug")), Level::Debug);
        assert_eq!(Level::parse(Some("info")), Level::Info);
        assert_eq!(Level::parse(Some("warn")), Level::Warn);
        assert_eq!(Level::parse(Some("error")), Level::Error);
        assert_eq!(Level::parse(Some("fatal")), Level::Error);
        assert_eq!(Level::parse(Some("silent")), Level::Silent);
    }

    #[test]
    fn falls_back_to_info_for_invalid_empty_or_missing_values() {
        assert_eq!(Level::parse(Some("verbose")), Level::Info);
        assert_eq!(Level::parse(Some("")), Level::Info);
        assert_eq!(Level::parse(None), Level::Info);
    }

    #[test]
    fn level_names_are_case_insensitive() {
        assert_eq!(Level::parse(Some("WARN")), Level::Warn);
        assert_eq!(Level::parse(Some("Debug")), Level::Debug);
    }

    #[test]
    fn silent_filters_everything() {
        assert_eq!(Level::Silent.as_level_filter(), LevelFilter::OFF);
        assert_eq!(Level::Trace.as_level_filter(), LevelFilter::TRACE);
    }
}
