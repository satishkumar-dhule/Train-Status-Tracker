//! Probe-based run-date derivation, ported 1:1 from `probeTrainRuns` and
//! `computeRunDates` in `lib/train-runs.ts`.
//!
//! Trains don't run every calendar day, so a fixed ±N-day window around today
//! is mostly wrong. Instead the provider is probed across the trailing 3 weeks
//! (today-20 .. today) and the train's running-weekday pattern is derived, then
//! the last 3 run dates up to today plus the next upcoming run are returned.
//!
//! Two signals are combined:
//!
//! 1. **Schedule note.** On a day the train does NOT run the status API
//!    answers `success` with a fallback schedule and a message like "This train
//!    runs only on MON,FRI". That message is the authoritative running
//!    schedule, and parsing it beats inference — it survives days whose probes
//!    fail with "wrong start date" (real run days far enough in the past) or
//!    drop out of the majority vote.
//! 2. **Probe inference.** When no schedule note is seen (e.g. a daily train),
//!    a weekday is trusted only when it ran on a majority of its probes, so a
//!    single spurious success on a non-running date cannot pollute the pattern.

use std::future::Future;

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};

use tt_provider_http::HttpTransport;
use tt_provider_paytm::{fetch_paytm_train_status, PaytmError};
use tt_trains_data::{to_api_date, weekday_of, LocalDate};

use crate::parse::parse_schedule_weekdays;

/// Days to look back when probing (inclusive of today): a 3-week window.
pub const RUN_WINDOW_DAYS: u32 = 20;

/// Default cap on concurrent upstream probes.
pub const DEFAULT_PROBE_CONCURRENCY: usize = 6;

/// The derived run pattern for one train.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunWeekdaysResult {
    /// Running weekday indices (0 = Sunday .. 6 = Saturday), from the schedule
    /// note when one was seen, else from the majority vote of the probes.
    pub weekdays: Vec<usize>,
    /// The parsed schedule note, when the provider reported one. Never
    /// `Some([])`: a parse that yields no tokens returns `None`, and a non-null
    /// note is the authoritative source for `weekdays`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule_weekdays: Option<Vec<usize>>,
    /// Probe dates (YYYYMMDD) that returned a run.
    #[serde(default)]
    pub observed_runs: Vec<String>,
    /// Probe dates whose fetch failed at the transport/provider level.
    #[serde(default)]
    pub upstream_failures: usize,
}

/// Options for [`probe_train_runs`] — the `{ now, windowDays, concurrency }`
/// option bag of the TS `probeTrainRuns`.
#[derive(Debug, Clone)]
pub struct ProbeTrainRunsOptions {
    /// The clock for "today". Defaults to [`LocalDate::today`].
    pub now: LocalDate,
    /// Days back to probe, inclusive of today. Defaults to
    /// [`RUN_WINDOW_DAYS`].
    pub window_days: u32,
    /// Max concurrent upstream probes. Defaults to 6.
    pub concurrency: usize,
}

impl Default for ProbeTrainRunsOptions {
    fn default() -> Self {
        ProbeTrainRunsOptions {
            now: LocalDate::today(),
            window_days: RUN_WINDOW_DAYS,
            concurrency: DEFAULT_PROBE_CONCURRENCY,
        }
    }
}

enum ProbeKind {
    Run,
    NoRun,
    Error,
}

struct ProbeOutcome {
    kind: ProbeKind,
    date: LocalDate,
    schedule: Option<Vec<usize>>,
}

/// Probes the provider across the trailing window and derives the train's
/// running-weekday pattern. Never fails — transport problems are counted in
/// [`RunWeekdaysResult::upstream_failures`] and the caller decides the verdict.
pub async fn probe_train_runs(
    transport: &dyn HttpTransport,
    train_number: &str,
    options: &ProbeTrainRunsOptions,
) -> RunWeekdaysResult {
    let dates = build_probe_dates(options.window_days, options.now);

    // Probe each date in bounded concurrency, preserving probe order.
    let outcomes = map_limited(&dates, options.concurrency, |date| {
        probe_one(transport, train_number, *date)
    })
    .await;

    let mut observed_runs: Vec<String> = Vec::new();
    let mut run_counts = [0usize; 7];
    let mut no_run_counts = [0usize; 7];
    let mut upstream_failures = 0usize;
    let mut schedule_weekdays: Option<Vec<usize>> = None;

    for outcome in outcomes {
        match outcome.kind {
            ProbeKind::Run => {
                run_counts[weekday_of(outcome.date)] += 1;
                observed_runs.push(to_api_date(&outcome.date.to_iso()));
            }
            ProbeKind::NoRun => {
                no_run_counts[weekday_of(outcome.date)] += 1;
            }
            ProbeKind::Error => {
                upstream_failures += 1;
            }
        }
        if schedule_weekdays.is_none() {
            schedule_weekdays = outcome.schedule;
        }
    }

    let weekdays = match schedule_weekdays {
        Some(ref schedule) => schedule.clone(),
        None => weekdays_from_majority(&run_counts, &no_run_counts),
    };

    RunWeekdaysResult {
        weekdays,
        schedule_weekdays,
        observed_runs,
        upstream_failures,
    }
}

/// The last 3 run dates (YYYYMMDD) up to today plus the next upcoming run,
/// ascending — port of `computeRunDates`.
pub fn compute_run_dates(weekdays: &[usize], now: LocalDate, window_days: u32) -> Vec<String> {
    if weekdays.is_empty() {
        return Vec::new();
    }

    let mut past: Vec<String> = Vec::new();
    for offset in (0..=window_days).rev() {
        let date = now.add_days(-(offset as i64));
        if weekdays.contains(&weekday_of(date)) {
            past.push(to_api_date(&date.to_iso()));
        }
    }

    let mut dates: Vec<String> = Vec::new();
    let start = past.len().saturating_sub(3);
    dates.extend_from_slice(&past[start..]);

    let mut offset = 1i64;
    loop {
        let date = now.add_days(offset);
        if weekdays.contains(&weekday_of(date)) {
            dates.push(to_api_date(&date.to_iso()));
            break;
        }
        offset += 1;
    }
    dates
}

/// Return probe dates from `today-window_days` to `today`, ascending.
fn build_probe_dates(window_days: u32, now: LocalDate) -> Vec<LocalDate> {
    let mut dates: Vec<LocalDate> = Vec::with_capacity(window_days as usize + 1);
    for offset in (0..=window_days).rev() {
        dates.push(now.add_days(-(offset as i64)));
    }
    dates
}

/// Map `items` through `f` with at most `limit` futures in flight, preserving
/// order. Port of `mapLimited`: a fixed worker count, processed in batches.
async fn map_limited<T, R, Fut>(items: &[T], limit: usize, f: impl Fn(&T) -> Fut) -> Vec<R>
where
    Fut: Future<Output = R>,
{
    if items.is_empty() {
        return Vec::new();
    }
    let workers = limit.min(items.len());
    let mut results: Vec<(usize, R)> = Vec::with_capacity(items.len());
    for (chunk_index, chunk) in items.chunks(workers).enumerate() {
        let futures: Vec<_> = chunk
            .iter()
            .enumerate()
            .map(|(offset, item)| {
                let index = chunk_index * workers + offset;
                let future = f(item);
                async move { (index, future.await) }
            })
            .collect();
        results.extend(join_all(futures).await);
    }
    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, value)| value).collect()
}

/// One probe: run, definitively-not-run, or an upstream failure.
async fn probe_one(
    transport: &dyn HttpTransport,
    train_number: &str,
    date: LocalDate,
) -> ProbeOutcome {
    let api_date = to_api_date(&date.to_iso());
    match fetch_paytm_train_status(transport, train_number, &api_date).await {
        Ok(payload) => {
            let schedule = payload
                .train_status_message
                .as_deref()
                .and_then(parse_schedule_weekdays);
            // A success that carries a parseable `runs only on` note is the
            // provider's fallback schedule: the train does NOT run on this
            // date. Only a success with no note counts as a run.
            let kind = if schedule.is_some() {
                ProbeKind::NoRun
            } else {
                ProbeKind::Run
            };
            ProbeOutcome {
                kind,
                date,
                schedule,
            }
        }
        // A provider-level not-found on a specific date also signals "does not
        // run that day", but a transport failure is an upstream failure.
        Err(PaytmError::NotFound(_)) => ProbeOutcome {
            kind: ProbeKind::NoRun,
            date,
            schedule: None,
        },
        Err(PaytmError::Upstream(_)) => ProbeOutcome {
            kind: ProbeKind::Error,
            date,
            schedule: None,
        },
    }
}

/// A weekday is trusted only when it ran on more probes than it did not run —
/// a single spurious success cannot pollute the pattern.
fn weekdays_from_majority(run_counts: &[usize; 7], no_run_counts: &[usize; 7]) -> Vec<usize> {
    let mut weekdays: Vec<usize> = Vec::new();
    for weekday in 0..7 {
        if run_counts[weekday] > no_run_counts[weekday] {
            weekdays.push(weekday);
        }
    }
    weekdays
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::Value;
    use tt_provider_http::{HttpTransport, MockTransport, Request, Response, TransportError};

    use super::*;

    const NOW: LocalDate = LocalDate {
        year: 2026,
        month: 8,
        day: 5,
    };

    /// `MockTransport` matches routes by URL path only, so every probe shares
    /// one route regardless of `departure_date`.
    const STATUS_PATH: &str = "/api/trains/v1/train/status";

    /// A `stubRunsOn`-style transport: parses the probe's `departure_date`
    /// query parameter and reports a run on matching weekdays and a `runs
    /// only on` schedule note on other days — the `stubRunsOn` helper of
    /// `train-runs.test.ts`. `MockTransport` matches by URL path only, so it
    /// cannot vary responses per probe date; this one can.
    struct RunsOnStub {
        weekdays: Vec<usize>,
    }

    impl RunsOnStub {
        fn new(weekdays: &[usize]) -> Arc<RunsOnStub> {
            Arc::new(RunsOnStub {
                weekdays: weekdays.to_vec(),
            })
        }
    }

    #[async_trait::async_trait]
    impl HttpTransport for RunsOnStub {
        async fn execute(&self, request: Request) -> Result<Response, TransportError> {
            let api_date = request
                .url
                .split("departure_date=")
                .nth(1)
                .and_then(|rest| rest.split('&').next())
                .unwrap_or_default()
                .to_string();
            let y: i32 = api_date[0..4].parse().unwrap_or(0);
            let m: u32 = api_date[4..6].parse().unwrap_or(0);
            let d: u32 = api_date[6..8].parse().unwrap_or(0);
            let date = LocalDate::new(y, m, d).unwrap_or(NOW);

            let payload = if self.weekdays.contains(&weekday_of(date)) {
                serde_json::json!({
                    "status": { "result": "success" },
                    "body": { "stations": [], "current_station": null },
                })
            } else {
                let days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| self.weekdays.contains(i))
                    .map(|(_, name)| *name)
                    .collect::<Vec<_>>()
                    .join(",");
                serde_json::json!({
                    "status": { "result": "success" },
                    "body": {
                        "stations": [],
                        "current_station": null,
                        "train_status_message": format!("This train runs only on {days}"),
                    },
                })
            };
            Ok(Response::new(
                200,
                serde_json::to_vec(&payload).expect("json is valid"),
            ))
        }
    }

    fn options() -> ProbeTrainRunsOptions {
        ProbeTrainRunsOptions {
            now: NOW,
            window_days: RUN_WINDOW_DAYS,
            concurrency: DEFAULT_PROBE_CONCURRENCY,
        }
    }

    #[tokio::test]
    async fn schedule_note_wins_over_inference_for_a_weekly_train() {
        let mock = RunsOnStub::new(&[3]);
        let result = probe_train_runs(mock.as_ref(), "12345", &options()).await;
        // Wednesdays only; the note is authoritative.
        assert_eq!(result.weekdays, vec![3]);
        assert_eq!(result.schedule_weekdays, Some(vec![3]));
        assert_eq!(result.observed_runs.len(), 3);
        assert_eq!(result.upstream_failures, 0);
        let runs = compute_run_dates(&result.weekdays, NOW, RUN_WINDOW_DAYS);
        assert_eq!(runs, vec!["20260722", "20260729", "20260805", "20260812"]);
    }

    #[tokio::test]
    async fn daily_train_is_derived_by_inference() {
        let mock = RunsOnStub::new(&[0, 1, 2, 3, 4, 5, 6]);
        let result = probe_train_runs(mock.as_ref(), "12345", &options()).await;
        assert_eq!(result.weekdays, vec![0, 1, 2, 3, 4, 5, 6]);
        assert_eq!(result.schedule_weekdays, None);
        let runs = compute_run_dates(&result.weekdays, NOW, RUN_WINDOW_DAYS);
        assert_eq!(runs, vec!["20260803", "20260804", "20260805", "20260806"]);
    }

    #[tokio::test]
    async fn an_unparseable_schedule_note_counts_every_probe_as_a_run() {
        // Every probe returns a "This train runs only on " note whose trailing
        // space does not match the regex (`\s+` then `[A-Za-z,\s]+` needs one
        // more character), so no schedule is parsed and every probe is
        // classified as a run. All 7 weekdays therefore get a run count and
        // the train looks daily. This mirrors the `stubRunsOn([])` case.
        let mut mock = MockTransport::new();
        mock.push_json(
            STATUS_PATH,
            &serde_json::json!({
                "status": { "result": "success" },
                "body": {
                    "stations": [],
                    "current_station": null,
                    "train_status_message": "This train runs only on ",
                },
            }),
        );
        let result = probe_train_runs(Arc::new(mock).as_ref(), "11111", &options()).await;
        assert_eq!(result.weekdays, vec![0, 1, 2, 3, 4, 5, 6]);
        let runs = compute_run_dates(&result.weekdays, NOW, RUN_WINDOW_DAYS);
        assert_eq!(runs, vec!["20260803", "20260804", "20260805", "20260806"]);
    }

    #[tokio::test]
    async fn a_genuine_not_found_yields_no_weekdays() {
        // Every probe positively answers "failure": the train does not exist,
        // so no weekday ever ran.
        let mut mock = MockTransport::new();
        mock.push_json(
            STATUS_PATH,
            &serde_json::json!({
                "error": true,
                "status": { "result": "failure" },
            }),
        );
        let result = probe_train_runs(Arc::new(mock).as_ref(), "99999", &options()).await;
        assert_eq!(result.weekdays, Vec::<usize>::new());
        assert_eq!(result.observed_runs, Vec::<String>::new());
        assert_eq!(result.upstream_failures, 0);
        let runs = compute_run_dates(&result.weekdays, NOW, RUN_WINDOW_DAYS);
        assert_eq!(runs, Vec::<String>::new());
    }

    #[tokio::test]
    async fn all_upstream_failures_are_counted() {
        let mut mock = MockTransport::new();
        mock.push(STATUS_PATH, 200, b"<html>oops</html>".to_vec());
        let result = probe_train_runs(Arc::new(mock).as_ref(), "77777", &options()).await;
        assert_eq!(result.weekdays, Vec::<usize>::new());
        assert_eq!(result.observed_runs, Vec::<String>::new());
        assert_eq!(result.upstream_failures, (RUN_WINDOW_DAYS + 1) as usize);
        let runs = compute_run_dates(&result.weekdays, NOW, RUN_WINDOW_DAYS);
        assert_eq!(runs, Vec::<String>::new());
    }

    #[test]
    fn result_round_trips_through_json_for_l2() {
        let result = RunWeekdaysResult {
            weekdays: vec![1, 5],
            schedule_weekdays: Some(vec![1, 5]),
            observed_runs: vec!["20260803".to_string()],
            upstream_failures: 2,
        };
        let value: Value = serde_json::to_value(&result).unwrap();
        let back: RunWeekdaysResult = serde_json::from_value(value).unwrap();
        assert_eq!(back.weekdays, vec![1, 5]);
        assert_eq!(back.schedule_weekdays, Some(vec![1, 5]));
        assert_eq!(back.observed_runs, vec!["20260803".to_string()]);
        assert_eq!(back.upstream_failures, 2);

        // A `None` schedule note round-trips distinctly from `Some([...])`:
        // it serializes to an omitted field, not an empty array.
        let none_result = RunWeekdaysResult {
            schedule_weekdays: None,
            ..result.clone()
        };
        let back: RunWeekdaysResult =
            serde_json::from_value(serde_json::to_value(&none_result).unwrap()).unwrap();
        assert_eq!(back.schedule_weekdays, None);
    }
}
