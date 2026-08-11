# Provider crate implementation spec (for background agents)

Build one or more `tt-provider-*` crates in `/home/runner/workspace/rust/crates/`.
Each crate is a **deep module** mirroring the already-green reference crates.
**You only create/edit files inside YOUR crate directory.** Do NOT touch the
workspace `Cargo.toml`, `Cargo.lock`, `registry.rs`, `config/`, `api-server/`,
or any other crate.

## READ FIRST

- Reference crate (JSON GET): `/home/runner/workspace/rust/crates/provider-confirmtkt/`
  — `src/lib.rs`, `src/provider.rs`, `src/map.rs`, `tests/confirmtkt.rs`.
- Reference crate (JSON with headers): `/home/runner/workspace/rust/crates/provider-redrail/`
- Reference crate (JSON POST + crypto): `/home/runner/workspace/rust/crates/provider-ntes/`
- HTML scraper reference: `/home/runner/workspace/rust/crates/provider-easemytrip/`
  (`fetch_provider_text` + `regex` + `LazyLock<Regex>`).
- The research doc with exact endpoint + payload shapes:
  `/home/runner/workspace/rust/docs/providers-research.md`
- Shared seams (DO NOT MODIFY, only consume):
  - `tt_provider_core`: `TrainStatusProvider` trait, `ProviderError`
    (`ProviderError::upstream(provider, msg)`, `ProviderError::not_found(provider)`),
    `ProviderFetchOptions`, and the parse helpers in `parse.rs`
    (`is_record`, `as_string`, `as_nullable_string`, `as_boolean`,
    `to_finite_number`, `to_positive_int`, `to_nullable_int`, `iso_time_of_day`).
  - `tt_provider_http`: `fetch_provider_json`, `fetch_provider_text`,
    `HttpTransport`, `Request` (`Request::get(url)`, `Request::post(url)`,
    `.header(name, value)`, `.json_body(&value)`).
  - `tt_mapper`: `ProviderStationRow`, `AssembleOptions`,
    `assemble_mapped_status`, `MappedStatus`, `to_wire_status`, `KnownTrain`.

## CRATE STRUCTURE (all under `crates/provider-<name>/`)

The skeleton (Cargo.toml + empty `src/lib.rs`/`src/map.rs`/`src/provider.rs` +
empty `tests/`) already exists. Replace the stubs with real code.

- `Cargo.toml` — already correct deps. JSON crates: async-trait, serde_json,
  tt-mapper, tt-provider-core, tt-provider-http, url. HTML crates add
  `regex = "1.12.1"`. Dev-deps: tokio + tt-provider-http/testkit. (NTES adds
  aes/cbc/md-5/base64/hex — already there.)
- `src/lib.rs` — re-export the `Provider` struct + `create_<name>_provider()`,
  `map_<name>_payload()` (or `map_<name>_html` for scrapers), plus the date
  converter. Keep the deep-module doc style of the reference crates.
- `src/provider.rs` — `Provider { transport: Arc<dyn HttpTransport> }`
  implementing `tt_provider_core::TrainStatusProvider`:
  - `name()` returns the registry key (see table below).
  - `enabled()` returns `true` (or key-gated for `indianrailapi`).
  - `fetch_train_status(train_number, departure_date, options, known_train)`
    builds the request, calls `fetch_provider_json`/`fetch_provider_text`, then
    maps.
  - Thread `options.abort` into the request exactly like the reference crates.
  - Unsupported date format → `ProviderError::upstream(provider, format!(...))`.
  - The date converter (`to_<name>_date`) maps `YYYYMMDD` to the upstream's
    format; return `None` for non-8-digit/`-`-containing input (copy the
    `to_confirmtkt_date`/`to_redrail_date` pattern).
- `src/map.rs` — `map_<name>_payload(raw: &Value, options: &AssembleOptions)
  -> Result<MappedStatus, ProviderError>` (JSON) or
  `parse_<name>_html(text) -> Vec<ProviderStationRow>` +
  `map_<name>_html(text, options) -> Result<MappedStatus, ProviderError>`
  (HTML scrapers, mirroring easemytrip). Use the `parse.rs` helpers — every
  upstream payload is untrusted (ZTA): unknown shapes become
  `None`/`""`/`false`, never panic.
- `tests/<name>.rs` — integration tests over fixture payloads via
  `MockTransport` (see the reference test files). Also unit-test the date
  converter and the not-found / upstream-error taxonomy.

## ERRORS (ZTA taxonomy)

- Body is not the expected shape / no stations parsed → `ProviderError::upstream`.
- Positively-confirmed "train not found" signal → `ProviderError::not_found`
  (only where the upstream has one, e.g. confirmtkt's `trainDataNotFound`).
- Anti-bot / captcha / Cloudflare / blocked-body signals (etrain, runningstatus,
  trainspnrstatus, railbeeps) → `ProviderError::upstream` — these are expected
  in this sandbox; do not treat as parse failures.

## PER-PROVIDER SPECS

### indianrailapi
- Key: `indianrailapi`. enabled() = `self.api_key.is_some()`.
- `GET https://indianrailapi.com/api/v2/livetrainstatus/apikey/{key}/trainnumber/{no}/date/{yyyymmdd}/`
  (key is a path segment, not a query param).
- `create_<name>_provider(transport, api_key: Option<String>)`.
- Response (documented): `TrainName`, `CurrentStationCode`, `CurrentStationName`,
  `DelayInMin`, `UpdateTime`, `Data`[] with `StationCode`, `StationName`,
  `ScheduleArrival`, `ScheduleDeparture`, `ActualArrival`, `ActualDeparture`,
  `Delay`, `DayCount`, `Distance`, `Platform`.

### trainspnrstatus
- Key: `trainspnrstatus`. enabled() = true.
- `POST https://trainspnrstatus.com/api/fetch-live-status` with JSON body
  `{"train_no": ..., "date": "YYYY-MM-DD"}` (so date converter → `YYYY-MM-DD`).
- Documented fields from their React bundle: train name, running-day message,
  station table with scheduled/actual timestamps and platform. The exact JSON
  keys are NOT captured live (Turnstile-guarded); build the mapper defensively:
  accept both `snake_case` and `camelCase` station keys, and treat the
  `cancelled`/`error` flags as `upstream` errors. Keep the mapper simple and
  conservative.

### railbeeps
- Key: `railbeeps`. enabled() = true.
- `GET https://api.railbeeps.com/api/getRunningStatus/api-key/{web_key}/trainno/{no}/date/{D MMM}`
  — the `web_key` is a fixed constant baked into NDTV's site bundle. Reverse
  engineering shows the pattern; no live capture available (no DNS here). Build
  defensively: accept a station array under `data`/`station`/`stations` keys;
  treat missing station data as `upstream`. Keep it conservative.

### etrain (HTML)
- Key: `etrain`. enabled() = true.
- `GET https://etrain.info/train/{slug}-{no}/live?date=YYYYMMDD` via
  `fetch_provider_text`. Slugs like `12301-RAJDHANI-EXPRES`; accept a
  best-effort slug (uppercase, spaces→`-`).
- The ajax endpoint is anti-bot gated — do NOT rely on it. If the fetched page
  lacks the station table (or contains the anti-bot message), return
  `ProviderError::upstream`.
- The server-rendered `/live` page structure was confirmed reachable; build
  regexes defensively against a table with station codes, scheduled/actual
  times, and platform. This is a best-effort scraper; the primary contract is
  that blocked/empty pages surface as `upstream`.

### erail (HTML)
- Key: `erail`. enabled() = true.
- `GET https://erail.in/train-enquiry/{train_no}` via `fetch_provider_text`.
- ASP.NET server-rendered page: a schedule table plus embedded JSON. Extract the
  station list (code/name/scheduled times/platform) — this is a **schedule**
  source; actuals may be absent. Mirror the easemytrip regex pattern.

### railmitra (HTML)
- Key: `railmitra`. enabled() = true.
- `GET https://www.railmitra.com/live-train-running-status/{train_no}` via
  `fetch_provider_text`. Server-rendered HTML with a status table. Title
  confirmed reachable. Defensive scraper; blocked pages → `upstream`.

### runningstatus (HTML)
- Key: `runningstatus`. enabled() = true.
- `GET https://runningstatus.in/status/{train_no}-on-{YYYYMMDD}` via
  `fetch_provider_text`.
- Cloudflare-guarded from this sandbox (403) → surfaces as `upstream`. The page
  structure is documented from Wayback; build the scraper against a table with
  station codes, scheduled/actual times, day, and delay. This is the site the
  RSTGCN paper scraped, so it's a primary-source target.

## VERIFY (per crate, in your crate dir)

```bash
export PATH="/nix/store/0nn2s2i80jxlvfv2hbknpk9hkll98vlh-rustup-1.25.1/bin:$PATH"
cd /home/runner/workspace/rust
cargo test -p tt-provider-<name>
cargo clippy -p tt-provider-<name> --all-targets -- -D warnings
```

Iterate until green. Do NOT run `cargo fmt --all` (it would touch other crates);
run `cargo fmt -p tt-provider-<name>` if formatting matters.

Return: list of files you created/changed + test/clippy status per crate.
