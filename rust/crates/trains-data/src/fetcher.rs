//! Upstream NTES train-list fetcher with fail-open semantics, ported 1:1 from
//! `lib/trains-data/src/fetcher.ts`.
//!
//! Design: the transport is injected (a [`HttpTransport`] dependency, never
//! created here) so the fetcher is fully testable without a network. Fetching
//! is hardened (timeout, bounded redirects, byte cap), single-flight in
//! process, TTL-cached, and any failure falls back to the bundled [`TRAINS`].

use std::io::Read;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::query::unique_by_number;
use crate::search::{search_trains, TrainEntry, TRAINS};

/// Upstream source of the official NTES train list (train numbers + names).
pub const TRAIN_DATA_DEFAULT_URL: &str =
    "https://enquiry.indianrail.gov.in/mntes/javascripts/train_data.js";

/// Cache-buster query parameter appended to the upstream URL (`?v=...`).
pub const TRAIN_DATA_VERSION_PARAM: &str = "v";

/// How long a fetched train list is kept before it is re-pulled. Default: 2h.
pub const TRAIN_DATA_DEFAULT_TTL_MS: u64 = 2 * 60 * 60 * 1000;

/// Abort the upstream fetch if it has not completed within this window.
pub const TRAIN_DATA_DEFAULT_TIMEOUT_MS: u64 = 10_000;

/// Maximum upstream redirects to follow before giving up.
pub const TRAIN_DATA_DEFAULT_MAX_REDIRECTS: u32 = 3;

/// Maximum number of response body bytes accepted from the upstream.
pub const TRAIN_DATA_DEFAULT_MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;

/// A single HTTP response as seen by the hardened fetch walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    /// HTTP status code.
    pub status: u16,
    /// `Location` header when `status` is 3xx.
    pub location: Option<String>,
    /// Raw response body bytes.
    pub body: Vec<u8>,
}

/// One-shot, single-hop HTTP transport. Implementations must NOT follow
/// redirects; the hardened fetch walks them itself with a bounded count.
pub trait HttpTransport: Send + Sync {
    /// Perform one request and return the response, or an error string.
    fn fetch(&self, url: &str) -> Result<HttpResponse, String>;
}

/// Real transport backed by `ureq` (rustls), no redirects, streaming body
/// reads bounded to `max_response_bytes`.
pub struct UreqTransport {
    agent: ureq::Agent,
    max_response_bytes: usize,
}

impl UreqTransport {
    pub fn new(timeout: Duration, max_response_bytes: usize) -> UreqTransport {
        let agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .timeout_global(Some(timeout))
            .build()
            .new_agent();
        UreqTransport {
            agent,
            max_response_bytes,
        }
    }
}

impl HttpTransport for UreqTransport {
    fn fetch(&self, url: &str) -> Result<HttpResponse, String> {
        match self.agent.get(url).call() {
            Ok(response) => {
                let status = response.status().as_u16();
                let location = response
                    .headers()
                    .get(ureq::http::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());
                if (300..400).contains(&status) {
                    return Ok(HttpResponse {
                        status,
                        location,
                        body: Vec::new(),
                    });
                }
                let (_, body) = response.into_parts();
                let mut reader = body
                    .into_with_config()
                    .limit(self.max_response_bytes as u64 + 1)
                    .reader();
                let mut buf = Vec::new();
                reader.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                if buf.len() > self.max_response_bytes {
                    return Err(format!(
                        "train data response exceeded the {}-byte limit",
                        self.max_response_bytes
                    ));
                }
                Ok(HttpResponse {
                    status,
                    location: None,
                    body: buf,
                })
            }
            Err(ureq::Error::StatusCode(code)) => Ok(HttpResponse {
                status: code,
                location: None,
                body: Vec::new(),
            }),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// Injectable clock: returns milliseconds since the Unix epoch.
pub type TrainDataClock = Arc<dyn Fn() -> u64 + Send + Sync>;

/// Invoked when the upstream load fails and the fallback dataset is used.
pub type TrainDataErrorHandler = Arc<dyn Fn(&str) + Send + Sync>;

/// Options for [`create_train_data_fetcher`]. Every field is optional.
#[derive(Default)]
pub struct TrainDataFetcherOptions {
    /// Absolute URL of the NTES train list JS.
    pub base_url: Option<String>,
    /// Cache-buster value appended as `?v=<version>`. Changing it produces a
    /// fresh source URL (and therefore a fresh fetch key).
    pub version: Option<String>,
    /// Time-to-live for the cached list in ms. Must be positive. Default: 2h.
    pub ttl_ms: Option<u64>,
    /// Abort the fetch after this many milliseconds. Must be positive.
    pub timeout_ms: Option<u64>,
    /// Maximum redirects followed (0 disables). Default: 3.
    pub max_redirects: Option<u32>,
    /// Reject response bodies larger than this many bytes. Must be positive.
    pub max_response_bytes: Option<usize>,
    /// Dataset used when the upstream fetch fails. Defaults to the bundled list.
    pub fallback: Option<Vec<TrainEntry>>,
    /// Injectable clock (ms since epoch) for tests.
    pub now: Option<TrainDataClock>,
    /// Injectable HTTP transport for tests. Defaults to [`UreqTransport`].
    pub transport: Option<Arc<dyn HttpTransport>>,
    /// Invoked when the upstream load fails and the fallback dataset is used.
    pub on_error: Option<TrainDataErrorHandler>,
}

/// A shared in-flight result so concurrent callers wait on one fetch.
struct SharedResult {
    inner: Mutex<Option<Result<Vec<TrainEntry>, String>>>,
    ready: Condvar,
}

impl SharedResult {
    fn new() -> SharedResult {
        SharedResult {
            inner: Mutex::new(None),
            ready: Condvar::new(),
        }
    }

    fn set(&self, value: Result<Vec<TrainEntry>, String>) {
        *self.inner.lock().expect("shared result lock") = Some(value);
        self.ready.notify_all();
    }

    fn wait(&self) -> Result<Vec<TrainEntry>, String> {
        let mut guard = self.inner.lock().expect("shared result lock");
        loop {
            if let Some(value) = guard.as_ref() {
                return value.clone();
            }
            guard = self
                .ready
                .wait(guard)
                .expect("shared result condition wait");
        }
    }
}

/// A TTL-cached, single-flight, fail-open train-list fetcher.
pub struct TrainDataFetcher {
    source_url: String,
    transport: Arc<dyn HttpTransport>,
    ttl_ms: u64,
    timeout_ms: u64,
    max_redirects: u32,
    max_response_bytes: usize,
    fallback: Vec<TrainEntry>,
    now: TrainDataClock,
    on_error: TrainDataErrorHandler,
    cache: Mutex<Option<(Vec<TrainEntry>, u64)>>,
    in_flight: Mutex<Option<Arc<SharedResult>>>,
}

impl TrainDataFetcher {
    /// The effective upstream URL, cache-buster applied.
    pub fn source_url(&self) -> &str {
        &self.source_url
    }

    /// The full train list (fetch + parse + TTL-cache, single-flight,
    /// fail-open). Never fails: the bundled dataset is returned on any error.
    pub fn get_trains(&self) -> Vec<TrainEntry> {
        match self.load() {
            Ok(trains) => trains,
            Err(err) => {
                (self.on_error)(&err);
                self.fallback.clone()
            }
        }
    }

    /// Fuzzy duck-typed search over the fetched list.
    pub fn search(&self, query: &str, limit: usize) -> Vec<TrainEntry> {
        let trains = self.get_trains();
        search_trains(query, limit, &trains)
    }

    fn load(&self) -> Result<Vec<TrainEntry>, String> {
        let now_ms = (self.now)();
        if let Some((trains, expires_at)) = self.cache.lock().expect("cache lock").as_ref() {
            if now_ms < *expires_at {
                return Ok(trains.clone());
            }
        }

        let shared;
        {
            let mut in_flight = self.in_flight.lock().expect("in-flight lock");
            if let Some(existing) = in_flight.as_ref() {
                return existing.wait();
            }
            shared = Arc::new(SharedResult::new());
            *in_flight = Some(Arc::clone(&shared));
        }

        let result = self.fetch_and_parse();
        shared.set(result.clone());
        self.in_flight.lock().expect("in-flight lock").take();
        result
    }

    fn fetch_and_parse(&self) -> Result<Vec<TrainEntry>, String> {
        let started_at = (self.now)();
        let response = self.hardened_fetch()?;
        if !(200..300).contains(&response.status) {
            return Err(format!(
                "train data fetch failed with HTTP {}",
                response.status
            ));
        }
        if response.body.len() > self.max_response_bytes {
            return Err(format!(
                "train data response exceeded the {}-byte limit",
                self.max_response_bytes
            ));
        }
        let text = String::from_utf8_lossy(&response.body);
        let trains = unique_by_number(&parse_train_data_js(&text));
        if trains.is_empty() {
            return Err("train data payload contained no valid entries".to_string());
        }
        *self.cache.lock().expect("cache lock") = Some((trains.clone(), started_at + self.ttl_ms));
        Ok(trains)
    }

    fn hardened_fetch(&self) -> Result<HttpResponse, String> {
        let (tx, rx) = channel();
        let transport = Arc::clone(&self.transport);
        let url = self.source_url.clone();
        let max_redirects = self.max_redirects;
        let timeout = self.timeout_ms;

        std::thread::spawn(move || {
            let mut current = url;
            let mut redirects = 0u32;
            loop {
                let response = match transport.fetch(&current) {
                    Ok(response) => response,
                    Err(error) => {
                        let _ = tx.send(Err(error));
                        return;
                    }
                };
                if (300..400).contains(&response.status) {
                    if let Some(location) = &response.location {
                        if redirects < max_redirects {
                            current = resolve_url(location, &current);
                            redirects += 1;
                            continue;
                        }
                    }
                    let _ = tx.send(Err(format!(
                        "train data fetch exceeded the redirect limit of {}",
                        max_redirects
                    )));
                    return;
                }
                let _ = tx.send(Ok(response));
                return;
            }
        });

        match rx.recv_timeout(Duration::from_millis(timeout)) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                Err(format!("train data fetch timed out after {}ms", timeout))
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err("train data fetch worker panicked".to_string())
            }
        }
    }
}

/// Resolve a redirect `location` against `base`, mirroring `new URL(location,
/// base)`. Only absolute http(s) URLs and plain relative paths are supported.
fn resolve_url(location: &str, base: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    let base_without_query = base.split(['?', '#']).next().unwrap_or(base);
    let directory = base_without_query
        .rfind('/')
        .map(|i| &base_without_query[..=i])
        .unwrap_or("/");
    format!("{}{}", directory, location.trim_start_matches('/'))
}

/// Build the upstream URL with the cache-busting `v` query parameter.
/// When `version` is omitted (or empty) the base URL is returned unchanged.
pub fn build_train_data_url(base_url: &str, version: Option<&str>) -> String {
    let version = version.unwrap_or("");
    if version.is_empty() {
        return base_url.to_string();
    }
    let encoded = encode_query_value(version);
    match base_url.find('?') {
        Some(query_pos) => {
            let before = &base_url[..query_pos];
            let query = &base_url[query_pos + 1..];
            let rest: Vec<&str> = query
                .split('&')
                .filter(|part| {
                    let key = part.split_once('=').map(|(k, _)| k).unwrap_or(part);
                    !part.is_empty() && key != TRAIN_DATA_VERSION_PARAM
                })
                .collect();
            if rest.is_empty() {
                format!("{}?v={}", before, encoded)
            } else {
                format!("{}?{}&v={}", before, rest.join("&"), encoded)
            }
        }
        None => format!("{}?v={}", base_url, encoded),
    }
}

/// Percent-encode a query value the way `URLSearchParams.set` does: space
/// becomes `+`, unreserved characters are kept, everything else is `%XX`.
fn encode_query_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(byte));
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

/// Extract the array body between `arrTrainList = [` and the trailing `];`
/// (mirroring the TS regex `/arrTrainList\s*=\s*\[([\s\S]*)\]\s*;?\s*$/`).
fn extract_array_body(raw: &str) -> Option<&str> {
    let s = raw.trim();
    let body_start = s.find("arrTrainList")?;
    let mut rest = &s[body_start + "arrTrainList".len()..];
    rest = rest.trim_start();
    rest = rest.strip_prefix('=')?;
    rest = rest.trim_start();
    rest = rest.strip_prefix('[')?;

    let mut last_good: Option<usize> = None;
    for (index, _) in rest.match_indices(']') {
        let tail = rest[index + 1..].trim_start();
        let closes = if tail.is_empty() {
            true
        } else if let Some(after) = tail.strip_prefix(';') {
            after.trim().is_empty()
        } else {
            false
        };
        if closes {
            last_good = Some(index);
        }
    }
    last_good.map(|index| &rest[..index])
}

/// Parse the raw NTES `train_data.js` payload
/// (`var arrTrainList = ["00111- BIRD-SGTY RAPID CARGO", ...];`) into
/// `TrainEntry`s. Non-conforming entries are skipped; garbage returns `[]`.
pub fn parse_train_data_js(raw: &str) -> Vec<TrainEntry> {
    let Some(body) = extract_array_body(raw) else {
        return Vec::new();
    };
    let wrapped = format!("[{}]", body);
    let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(&wrapped) else {
        return Vec::new();
    };
    let mut trains = Vec::new();
    for entry in entries {
        let serde_json::Value::String(raw_entry) = entry else {
            continue;
        };
        if let Some(parsed) = parse_train_list_entry(&raw_entry) {
            trains.push(parsed);
        }
    }
    trains
}

/// `"00111- BIRD-SGTY RAPID CARGO"` -> `{ number: "00111", name: "BIRD-SGTY RAPID CARGO" }`.
fn parse_train_list_entry(raw: &str) -> Option<TrainEntry> {
    let separator = raw.find("- ")?;
    if separator == 0 {
        return None;
    }
    let number = raw[..separator].trim();
    let name = raw[separator + 2..].trim();
    if number.len() != 5 || !number.bytes().all(|b| b.is_ascii_digit()) || name.is_empty() {
        return None;
    }
    Some(TrainEntry {
        number: number.to_string(),
        name: name.to_string(),
    })
}

fn default_now() -> TrainDataClock {
    Arc::new(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    })
}

fn noop_on_error() -> TrainDataErrorHandler {
    Arc::new(|_: &str| {})
}

/// Build a train-data fetcher, validating the hardening options (mirroring the
/// TS constructor which throws on invalid values). Defaults match the TS.
pub fn create_train_data_fetcher(
    options: TrainDataFetcherOptions,
) -> Result<TrainDataFetcher, String> {
    let ttl_ms = options.ttl_ms.unwrap_or(TRAIN_DATA_DEFAULT_TTL_MS);
    let timeout_ms = options.timeout_ms.unwrap_or(TRAIN_DATA_DEFAULT_TIMEOUT_MS);
    let max_redirects = options
        .max_redirects
        .unwrap_or(TRAIN_DATA_DEFAULT_MAX_REDIRECTS);
    let max_response_bytes = options
        .max_response_bytes
        .unwrap_or(TRAIN_DATA_DEFAULT_MAX_RESPONSE_BYTES);

    if ttl_ms == 0 {
        return Err("ttlMs must be positive".to_string());
    }
    if timeout_ms == 0 {
        return Err("timeoutMs must be a positive finite number".to_string());
    }
    // `max_redirects` is `u32` here, so the TS guards (non-integer, < 0) are
    // enforced by the type system at compile time.
    if max_response_bytes == 0 {
        return Err("maxResponseBytes must be a positive finite number".to_string());
    }

    let source_url = build_train_data_url(
        &options
            .base_url
            .unwrap_or_else(|| TRAIN_DATA_DEFAULT_URL.to_string()),
        options.version.as_deref(),
    );
    let transport = options.transport.unwrap_or_else(|| {
        Arc::new(UreqTransport::new(
            Duration::from_millis(timeout_ms),
            max_response_bytes,
        ))
    });
    let fallback = options.fallback.unwrap_or_else(|| TRAINS.clone());
    let now = options.now.unwrap_or_else(default_now);
    let on_error = options.on_error.unwrap_or_else(noop_on_error);

    Ok(TrainDataFetcher {
        source_url,
        transport,
        ttl_ms,
        timeout_ms,
        max_redirects,
        max_response_bytes,
        fallback,
        now,
        on_error,
        cache: Mutex::new(None),
        in_flight: Mutex::new(None),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Mutex as StdMutex;

    const SAMPLE_JS: &str = "var arrTrainList = [\"00111- BIRD-SGTY RAPID CARGO\",\n\
\"12001- Bhopal Shatabdi Express\",\n\
\"12002- New Delhi Shatabdi Express\",\n\
\"22943- Indore Intercity SF Express\",\n\
\"99999- MUMBAI-RAJDHANI EXPRESS\"\n\
];";

    fn entry(number: &str, name: &str) -> TrainEntry {
        TrainEntry {
            number: number.to_string(),
            name: name.to_string(),
        }
    }

    fn sample_trains() -> Vec<TrainEntry> {
        vec![
            entry("00111", "BIRD-SGTY RAPID CARGO"),
            entry("12001", "Bhopal Shatabdi Express"),
            entry("12002", "New Delhi Shatabdi Express"),
            entry("22943", "Indore Intercity SF Express"),
            entry("99999", "MUMBAI-RAJDHANI EXPRESS"),
        ]
    }

    fn ok_response(body: &str) -> HttpResponse {
        HttpResponse {
            status: 200,
            location: None,
            body: body.as_bytes().to_vec(),
        }
    }

    /// A transport driven by a plain closure; the same shape a real adapter
    /// (e.g. `UreqTransport`) implements.
    type MockFetch = Arc<dyn Fn(&str) -> Result<HttpResponse, String> + Send + Sync>;

    struct MockTransport {
        inner: MockFetch,
    }

    impl MockTransport {
        fn new(
            inner: impl Fn(&str) -> Result<HttpResponse, String> + Send + Sync + 'static,
        ) -> MockTransport {
            MockTransport {
                inner: Arc::new(inner),
            }
        }
    }

    impl HttpTransport for MockTransport {
        fn fetch(&self, url: &str) -> Result<HttpResponse, String> {
            (self.inner)(url)
        }
    }

    fn counting_transport(count: &Arc<AtomicUsize>, body: &'static str) -> Arc<dyn HttpTransport> {
        let count = Arc::clone(count);
        Arc::new(MockTransport::new(move |_url: &str| {
            count.fetch_add(1, Ordering::SeqCst);
            Ok(ok_response(body))
        }))
    }

    /// A mutable clock, mirroring the `makeNow()` helper in fetcher.test.ts.
    struct Clock(Arc<AtomicU64>);

    impl Clock {
        fn new() -> Clock {
            Clock(Arc::new(AtomicU64::new(1_000_000)))
        }

        fn advance(&self, ms: u64) {
            self.0.fetch_add(ms, Ordering::SeqCst);
        }

        fn as_fn(&self) -> TrainDataClock {
            let c = Arc::clone(&self.0);
            Arc::new(move || c.load(Ordering::SeqCst))
        }
    }

    /// Records every fail-open notification, mirroring the `onError` spy.
    struct ErrorRecorder(Arc<StdMutex<Vec<String>>>);

    impl ErrorRecorder {
        fn new() -> ErrorRecorder {
            ErrorRecorder(Arc::new(StdMutex::new(Vec::new())))
        }

        fn messages(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }

        fn as_fn(&self) -> TrainDataErrorHandler {
            let inner = Arc::clone(&self.0);
            Arc::new(move |message: &str| inner.lock().unwrap().push(message.to_string()))
        }
    }

    fn make_fetcher(
        transport: Arc<dyn HttpTransport>,
        options: TrainDataFetcherOptions,
    ) -> TrainDataFetcher {
        create_train_data_fetcher(TrainDataFetcherOptions {
            transport: Some(transport),
            ..options
        })
        .expect("fetcher options are valid")
    }

    // Port of `parseTrainDataJs` in fetcher.test.ts.
    #[test]
    fn parses_the_ntes_array_into_entries() {
        assert_eq!(parse_train_data_js(SAMPLE_JS), sample_trains());
    }

    #[test]
    fn splits_on_the_first_dash_space_so_hyphens_inside_names_survive() {
        let trains = parse_train_data_js("var arrTrainList = [\"00111- BIRD-SGTY RAPID CARGO\"];");
        assert_eq!(
            trains.first(),
            Some(&entry("00111", "BIRD-SGTY RAPID CARGO")),
        );
    }

    #[test]
    fn skips_entries_with_malformed_numbers_or_empty_names() {
        let raw = "var arrTrainList = [\"12001- Bhopal Shatabdi Express\", \"garbage\", \
        \"no-dash\", \"1234- short\", \"54321- \"];";
        assert_eq!(
            parse_train_data_js(raw),
            vec![entry("12001", "Bhopal Shatabdi Express")],
        );
    }

    #[test]
    fn returns_empty_for_garbage_input() {
        assert_eq!(parse_train_data_js("not javascript at all"), Vec::new());
        assert_eq!(parse_train_data_js("var arrTrainList = {}"), Vec::new());
        assert_eq!(parse_train_data_js(""), Vec::new());
    }

    // Port of `buildTrainDataUrl` in fetcher.test.ts.
    #[test]
    fn returns_the_base_url_unchanged_without_a_version() {
        assert_eq!(
            build_train_data_url(TRAIN_DATA_DEFAULT_URL, None),
            TRAIN_DATA_DEFAULT_URL,
        );
    }

    #[test]
    fn appends_the_v_query_param() {
        assert_eq!(
            build_train_data_url(TRAIN_DATA_DEFAULT_URL, Some("202608051517")),
            format!("{TRAIN_DATA_DEFAULT_URL}?v=202608051517"),
        );
    }

    #[test]
    fn overrides_an_existing_v_param() {
        let with_v = build_train_data_url(TRAIN_DATA_DEFAULT_URL, Some("1"));
        assert_eq!(
            build_train_data_url(&with_v, Some("2")),
            format!("{TRAIN_DATA_DEFAULT_URL}?v=2"),
        );
    }

    #[test]
    fn encodes_a_custom_version_value() {
        assert_eq!(
            build_train_data_url(TRAIN_DATA_DEFAULT_URL, Some("a b&c")),
            format!("{TRAIN_DATA_DEFAULT_URL}?v=a+b%26c"),
        );
    }

    // Port of `createTrainDataFetcher` in fetcher.test.ts.
    #[test]
    fn fetches_parses_and_caches_within_the_ttl() {
        let count = Arc::new(AtomicUsize::new(0));
        let fetcher = make_fetcher(
            counting_transport(&count, SAMPLE_JS),
            TrainDataFetcherOptions {
                ttl_ms: Some(TRAIN_DATA_DEFAULT_TTL_MS),
                ..Default::default()
            },
        );

        let first = fetcher.get_trains();
        let second = fetcher.get_trains();

        assert_eq!(first, sample_trains());
        assert_eq!(second, first);
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn refetches_after_the_ttl_expires() {
        let count = Arc::new(AtomicUsize::new(0));
        let clock = Clock::new();
        let fetcher = make_fetcher(
            counting_transport(&count, SAMPLE_JS),
            TrainDataFetcherOptions {
                ttl_ms: Some(1000),
                now: Some(clock.as_fn()),
                ..Default::default()
            },
        );

        fetcher.get_trains();
        clock.advance(1001);
        fetcher.get_trains();

        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn single_flights_concurrent_callers() {
        let count = Arc::new(AtomicUsize::new(0));
        let count_for_transport = Arc::clone(&count);
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(move |_url: &str| {
            count_for_transport.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(10));
            Ok(ok_response(SAMPLE_JS))
        }));
        let fetcher = Arc::new(make_fetcher(transport, TrainDataFetcherOptions::default()));

        let handle_a = {
            let fetcher = Arc::clone(&fetcher);
            std::thread::spawn(move || fetcher.get_trains())
        };
        let handle_b = {
            let fetcher = Arc::clone(&fetcher);
            std::thread::spawn(move || fetcher.get_trains())
        };

        let a = handle_a.join().expect("thread a");
        let b = handle_b.join().expect("thread b");

        assert_eq!(a, b);
        assert_eq!(a, sample_trains());
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn falls_back_to_the_bundled_dataset_on_fetch_failure() {
        let recorder = ErrorRecorder::new();
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(|_url: &str| {
            Err("fetch failed".to_string())
        }));
        let fetcher = make_fetcher(
            transport,
            TrainDataFetcherOptions {
                on_error: Some(recorder.as_fn()),
                ..Default::default()
            },
        );

        let trains = fetcher.get_trains();

        assert_eq!(trains.len(), TRAINS.len());
        assert_eq!(trains, *TRAINS);
        assert_eq!(recorder.messages().len(), 1);
    }

    #[test]
    fn falls_back_when_the_upstream_returns_a_non_200_response() {
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(|_url: &str| {
            Ok(HttpResponse {
                status: 500,
                location: None,
                body: b"boom".to_vec(),
            })
        }));
        let fetcher = make_fetcher(transport, TrainDataFetcherOptions::default());

        let trains = fetcher.get_trains();
        assert_eq!(trains, *TRAINS);
    }

    #[test]
    fn falls_back_when_the_payload_is_empty() {
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(|_url: &str| {
            Ok(ok_response("var arrTrainList = [];"))
        }));
        let fallback = vec![entry("12001", "Bhopal Shatabdi Express")];
        let fetcher = make_fetcher(
            transport,
            TrainDataFetcherOptions {
                fallback: Some(fallback.clone()),
                ..Default::default()
            },
        );

        assert_eq!(fetcher.get_trains(), fallback);
    }

    #[test]
    fn does_not_cache_failures_so_the_next_call_retries() {
        let count = Arc::new(AtomicUsize::new(0));
        let transport_count = Arc::clone(&count);
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(move |_url: &str| {
            let call = transport_count.fetch_add(1, Ordering::SeqCst);
            if call == 0 {
                Err("down".to_string())
            } else {
                Ok(ok_response(SAMPLE_JS))
            }
        }));
        let fetcher = make_fetcher(transport, TrainDataFetcherOptions::default());

        let first = fetcher.get_trains();
        let second = fetcher.get_trains();

        assert_ne!(first, sample_trains());
        assert_eq!(second, sample_trains());
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn uses_a_different_cache_key_when_the_version_changes() {
        let count = Arc::new(AtomicUsize::new(0));
        let transport = counting_transport(&count, SAMPLE_JS);
        let a = make_fetcher(
            Arc::clone(&transport),
            TrainDataFetcherOptions {
                version: Some("1".to_string()),
                ..Default::default()
            },
        );
        let b = make_fetcher(
            transport,
            TrainDataFetcherOptions {
                version: Some("2".to_string()),
                ..Default::default()
            },
        );

        a.get_trains();
        b.get_trains();

        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert!(a.source_url().contains("v=1"));
        assert!(b.source_url().contains("v=2"));
    }

    #[test]
    fn rejects_a_non_positive_ttl() {
        assert!(create_train_data_fetcher(TrainDataFetcherOptions {
            ttl_ms: Some(0),
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn rejects_invalid_hardening_options() {
        assert!(create_train_data_fetcher(TrainDataFetcherOptions {
            timeout_ms: Some(0),
            ..Default::default()
        })
        .is_err());
        assert!(create_train_data_fetcher(TrainDataFetcherOptions {
            max_response_bytes: Some(0),
            ..Default::default()
        })
        .is_err());
        // `max_redirects` cannot even be negative here: the field is `u32`, so
        // the TS `maxRedirects < 0` guard is enforced at compile time.
    }

    #[test]
    fn aborts_the_upstream_fetch_when_it_exceeds_the_timeout() {
        let recorder = ErrorRecorder::new();
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(|_url: &str| loop {
            std::thread::sleep(Duration::from_millis(10_000));
        }));
        let fetcher = make_fetcher(
            transport,
            TrainDataFetcherOptions {
                on_error: Some(recorder.as_fn()),
                timeout_ms: Some(20),
                ..Default::default()
            },
        );

        let trains = fetcher.get_trains();

        assert_eq!(trains, *TRAINS);
        assert_eq!(recorder.messages().len(), 1);
        assert!(recorder.messages()[0].contains("timed out"));
    }

    #[test]
    fn follows_a_bounded_number_of_redirects_then_succeeds() {
        let count = Arc::new(AtomicUsize::new(0));
        let transport_count = Arc::clone(&count);
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(move |url: &str| {
            transport_count.fetch_add(1, Ordering::SeqCst);
            if url.contains("enquiry.indianrail.gov.in") {
                Ok(HttpResponse {
                    status: 302,
                    location: Some("https://mirror.example/train_data.js?v=2".to_string()),
                    body: Vec::new(),
                })
            } else {
                Ok(ok_response(SAMPLE_JS))
            }
        }));
        let fetcher = make_fetcher(
            transport,
            TrainDataFetcherOptions {
                max_redirects: Some(3),
                ..Default::default()
            },
        );

        assert_eq!(fetcher.get_trains(), sample_trains());
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn falls_back_when_redirects_exceed_the_cap() {
        let recorder = ErrorRecorder::new();
        let count = Arc::new(AtomicUsize::new(0));
        let transport_count = Arc::clone(&count);
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(move |_url: &str| {
            transport_count.fetch_add(1, Ordering::SeqCst);
            Ok(HttpResponse {
                status: 302,
                location: Some("https://mirror.example/train_data.js".to_string()),
                body: Vec::new(),
            })
        }));
        let fetcher = make_fetcher(
            transport,
            TrainDataFetcherOptions {
                on_error: Some(recorder.as_fn()),
                max_redirects: Some(2),
                ..Default::default()
            },
        );

        let trains = fetcher.get_trains();

        assert_eq!(trains, *TRAINS);
        assert_eq!(count.load(Ordering::SeqCst), 3);
        assert_eq!(recorder.messages().len(), 1);
        assert!(recorder.messages()[0].contains("redirect"));
    }

    #[test]
    fn falls_back_when_the_response_body_exceeds_the_byte_cap() {
        let recorder = ErrorRecorder::new();
        let transport: Arc<dyn HttpTransport> = Arc::new(MockTransport::new(|_url: &str| {
            Ok(ok_response(&"x".repeat(4096)))
        }));
        let fetcher = make_fetcher(
            transport,
            TrainDataFetcherOptions {
                on_error: Some(recorder.as_fn()),
                max_response_bytes: Some(1024),
                ..Default::default()
            },
        );

        let trains = fetcher.get_trains();

        assert_eq!(trains, *TRAINS);
        assert_eq!(recorder.messages().len(), 1);
        assert!(recorder.messages()[0].contains("exceeded"));
    }

    #[test]
    fn search_runs_the_fuzzy_matcher_against_the_fetched_list() {
        let count = Arc::new(AtomicUsize::new(0));
        let fetcher = make_fetcher(
            counting_transport(&count, SAMPLE_JS),
            TrainDataFetcherOptions::default(),
        );

        let by_number = fetcher.search("229", 10);
        assert_eq!(
            by_number.first(),
            Some(&entry("22943", "Indore Intercity SF Express")),
        );

        let by_name = fetcher.search("shatabdi", 10);
        assert!(by_name
            .iter()
            .any(|t| t.number == "12001" && t.name == "Bhopal Shatabdi Express"));
    }

    #[test]
    fn exposes_the_effective_source_url() {
        let fetcher = create_train_data_fetcher(TrainDataFetcherOptions {
            version: Some("202608051517".to_string()),
            transport: Some(Arc::new(MockTransport::new(|_url: &str| {
                Err("unused".to_string())
            }))),
            ..Default::default()
        })
        .expect("fetcher options are valid");
        assert_eq!(
            fetcher.source_url(),
            format!("{TRAIN_DATA_DEFAULT_URL}?v=202608051517"),
        );
    }
}
