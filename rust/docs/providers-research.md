# Train-status providers: research, verification, and integration analysis

Deep-analysis report for adding 10 new live train-status providers to the Rail Saarthi
Rust backend (`rust-port`). Companion to the existing adapters
(`paytm`, `goibibo`, `railyatri`, `whereismytrain`, `easemytrip`, `railradar`).

Status: **research + live verification complete; implementation pending.**

---

## 1. Verification method

Every candidate was probed from this environment with `curl`/Node (real HTTP, real DNS),
not just documented. Payload samples were captured to
`/tmp/opencode/provider-probes/*.json`. "Verified" below means a **real 200 response with a
concrete station list for train 12301 / HWH RAJDHANI** was observed on the probe date.

Confidence tiers:

| Tier | Meaning |
|---|---|
| **A — verified live** | Working endpoint + full payload captured here |
| **B — documented + reachable** | Endpoint reachable; payload shape known from reverse-engineered production bundles / source |
| **C — documented, blocked here** | Payload shape known; endpoint blocked from this sandbox (DNS / Cloudflare / anti-bot) |
| **D — dead/unusable** | Not worth implementing |

## 2. Final 10 provider picks

| # | Crate name | Upstream | Tier | Auth/transport |
|---|---|---|---|---|
| 1 | `tt-provider-confirmtkt` | api.confirmtkt.com | **A** | None, JSON GET |
| 2 | `tt-provider-redrail` | loco.redbus.com (RedBus Rail / redRail) | **A** | Channel headers, JSON GET |
| 3 | `tt-provider-ntes` | enquiry.indianrail.gov.in (CRIS official) | **A** | AES-128-CBC envelope, JSON POST |
| 4 | `tt-provider-indianrailapi` | indianrailapi.com | **B** | API key (query param), JSON GET |
| 5 | `tt-provider-etrain` | etrain.info (TripOzo) | **B** | None, server-rendered HTML |
| 6 | `tt-provider-erail` | erail.in | **B** | None, ASP.NET server-rendered HTML |
| 7 | `tt-provider-railmitra` | railmitra.com | **C** | None, server-rendered HTML |
| 8 | `tt-provider-runningstatus` | runningstatus.in | **C** | Cloudflare HTML scrape |
| 9 | `tt-provider-trainspnrstatus` | trainspnrstatus.com | **C** | JSON POST (Turnstile-guarded) |
| 10 | `tt-provider-railbeeps` | api.railbeeps.com (NDTV) | **C** | Web API key in URL, JSON GET |

Candidates examined and **rejected**: railwayapi.com (dead), trainman.in (S3 bucket gone),
rail.ndtv.com / rail.redbus.in / api.railmitra.com (no DNS), ixigo (JS-only SPA shells,
no server-rendered data), ConfirmTkt sister sites (same upstream as #1).

---

## 3. Tier A — verified live

### 3.1 confirmtkt (`api.confirmtkt.com`)

`GET https://api.confirmtkt.com/api/trains/livestatusall`

| Query param | Value | Notes |
|---|---|---|
| `trainno` | train number | e.g. `12301` |
| `doj` | `dd-mm-yyyy` | NOT the ISO date the API sometimes echoes |
| `locale` | `en` | |
| `session` | random hex | any value works |

Request headers: `User-Agent: okhttp/4.9.2` (other UAs also accepted).

Captured payload keys (re-verified 10-Aug-2026):
- `trainNo`, `trainName` (may be `null`), `fromIxigo`
- `trainDataFound`: `"trainRunningDataFound"` or `"trainDataNotFound"`
- `departed` (bool), `terminated` (bool)
- `curStn` / `curStnName` (current station code/name)
- `lastUpdated` (human string like `09 Aug 2026 00:05, (Disclaimer: ...)`), `startDate`
  (`dd-mm-yyyy`), `totalLateMins`, `isRunningDataAvailable`, `Error`
- `stations[]` — per station: `stnCode`, `stnCodeName`, `haltMinutes`,
  `actArr`, `actDep` (`HH:mm`), `dayCnt`, `schArrTime`, `schDepTime` (`HH:mm`, may be
  empty for origin/destination), `schDayCnt`, `delayArr`, `delayDep` (ints, may be
  negative), `arr`, `dep` (0/1 flags), `distance` (km int), `ExpectedPlatformNo`
  (string like `"9"`), `stoppingStn` (bool), `travelled` (bool), `dayDiff`,
  `journeyDate`.

Field mapping notes:
- `actArr`/`actDep` are the **actual** times (`HH:mm`); `schArrTime`/`schDepTime` are
  scheduled. A `travelled: false` station has empty actuals.
- Delay minutes come precomputed as `delayArr`/`delayDep` (ints, may be negative for early).
- Platform = `ExpectedPlatformNo` (string; `0`/empty when unknown).
- Current station: prefer top-level `curStn`, else last station with a non-empty
  `actArr`/`actDep`.
- `trainName` can be `null` — fall back to the known-train name / `Train {no}`.
- A journey with `trainDataFound === "trainDataNotFound"` returns empty `stations` —
  map to a NotFound-ish response, not a parse error.

### 3.2 redrail / RedBus Rail (`loco.redbus.com`)

`GET https://loco.redbus.com/api/Rails/v2/RIS/GetLiveTrainStatus/?trainNo={no}`

Required headers (missing ones → 4xx/empty):

| Header | Value |
|---|---|
| `Channel_name` | `MOBILE_APP` |
| `Os` | `Android` |
| `Accept` | `application/json` |
| `Appversion` | `5.5.1` |
| `Auth_key` | `1` |
| `Appversioncode` | `505010` |
| `Language` | `en` |
| `Businessunit` | `REDRAIL` |
| `Currency` | `INR` |
| `Country_name` | `IND` | **required as of Aug 2026** — missing → 401 `Invalid Headers, Country Name is missing`; wrong value (e.g. `IN`, `India`) → 401 `Country Name is incorrect` |
| `User-Agent` | `okhttp/4.11.0` |

Captured payload keys (re-verified 10-Aug-2026; shapes changed vs earlier probes — times
are `HH:mm` strings now, not ISO timestamps):
- `trainNumber`, `trainName`
- `consideredRunningDate` (YYYYMMDD string — the journey's departure date)
- `currentlyAt` / `currentlyAtCode` (top-level current station — prefer over inferring)
- `runningStatus` (object `{ header, status, runningStatusMessage }`), `totalLateMins`,
  `ltsLastUpdatedTime` (e.g. `11:12 AM August 10`)
- `stations[]` — per station: `stationName`, `stationCode`, `distanceFromOrigin`
  (string `"N kms"`), `platform` (string `"PLATFORM N"`), `scheduledArrivalTime`,
  `arrivalTime`, `scheduledDepartureTime`, `departureTime` (`HH:mm`, or sentinel
  `"SOURCE"`/`"DESTINATION"`), `dayCount`, `arrivalDate`/`departureDate` (YYYYMMDD or null),
  `delayArr`, `delayDep` (minutes int or null), `isItQueriedStation` (bool),
  `intermediateStations[]` (nested halts: `stationName`, `stationCode`, `scheduledTime`,
  `distanceFromOrigin`), plus `hasArrived`/`hasDeparted`/`delayStatus` per station.

Field mapping notes:
- Times are `HH:mm` strings; `"SOURCE"`/`"DESTINATION"` mark the endpoints — treat any
  non-`HH:mm` value as absent. `arrivalDate`/`departureDate` are YYYYMMDD strings.
- `delayArr`/`delayDep` are nullable ints; absent delay → treat as 0.
- `distanceFromOrigin` is a string like `"200 kms"` — strip the unit; `platform` is
  `"PLATFORM 4"` — strip the prefix.
- Current station: prefer top-level `currentlyAtCode`, else the last station with a
  populated `arrivalTime`.
- Nested `intermediateStations[]` are halts, not full stations — skip them.

### 3.3 NTES / CRIS official (`enquiry.indianrail.gov.in`)

`POST https://enquiry.indianrail.gov.in/crisns/AppServAnd` — the official CRIS mobile
endpoint, protected by an AES-128-CBC envelope.

Request body: `{ "jsonIn": "<hex(MD5(plaintext + sckey))>#<HEX(base64(AES128CBC(plaintext)))>" }`

Fixed crypto constants (published in the open-source `ntes-client`; see §6):
- AES key: `8EA4DB2CC1EB3DC5`
- AES IV: `7DC5EB3BB4DB6EA8`
- `sckey`: `645fbc1e56e23365f2f3c204ae0899f6`

Plaintext payload:
```
service=TrainRunningMob&subService=ShowFullRunJson&trainNo=12301&startDate=10-Aug-2026
```
`startDate` is `DD-MMM-YYYY`. MD5 must be **uppercase hex**; AES/CBC with PKCS7 padding;
the base64 of the ciphertext is then hex-encoded again. AES key/iv are plain ASCII (16
bytes each).

Captured response (decrypted JSON, train 12301 on 10-Aug-2026) keys:
- Train header: `TN`, `TNM`, `SRC`, `SRCN`, `DSTN`, `DSTNN`
- Position: `CPOS` (human text like `"Yet to start from its source"` or a station),
  `LDEL` (delay minutes int), `LTIME` (last position time), `LUPDT`/`LUPDFULL`/`LASTUPD`
  (last update, `HH:mm DD-MMM`), `ISPTT` (bool on-time flag), `TRUNST` (running status
  int/text), `LEVNT` (last event), `LSTN`/`NPSTN`/`NSTN` (last/next station codes),
  `TTLDIST`, `AlertMsg`, `STNSD`/`STNSDISP` (display strings)
- `STNS[]` — per station: `SC` (code), `SN` (name), `STA`/`STD` (scheduled arr/dep),
  `ETA`/`ETD` (expected arr/dep), `DARR`/`DDEP` (actual arr/dep), `ISD`/`ISA`
  (bool in-station arr/dep flags), `DIST` (km int), `PF` (platform string), `DF`
  (day offset int), `SHN` (Hindi name), `Sr` (serial).

Time sentinels (verified): `STA`/`STD`/`ETA`/`ETD` are `HH:mm DD-MMM` strings (e.g.
`18:47 10-Aug`), with `"Source"`/`"DESTINATION"` for the endpoints. `DARR`/`DDEP` are
`"On Time"` or empty when not yet actual. `PF` is a platform string like `"9"`.

Field mapping notes:
- Expected vs actual: `ETA`/`ETD` are expected (live-projected); `DARR`/`DDEP` are
  actuals — but actuals render as `"On Time"`/empty, so treat `DARR`/`DDEP` as absent
  unless they look like a real time.
- Scheduled times `STA`/`STD` carry the `HH:mm DD-MMM` format — slice to `HH:mm`.
- `LDEL` is the current delay in minutes (may be negative).
- `DF` is the day offset (0-based in this response: origin `DF:0`, day-2 stations `DF:1`).
- Current station: `CPOS` is human text; prefer `LSTN` (last station) or the last station
  with a real `DARR`/`DDEP`.
- Empty/short response bodies were observed for other `subService` values; if `STNS`
  is missing treat as upstream error (the service occasionally returns `{}`).

---

## 4. Tier B — documented, reachable

### 4.1 indianrailapi (`indianrailapi.com`)

`GET https://indianrailapi.com/api/v2/livetrainstatus/apikey/{key}/trainnumber/{no}/date/{yyyymmdd}/`

- Key-gated exactly like the existing `railradar` provider → **do not put in the default
  provider order**; enable only when `INDIANRAILAPI_API_KEY` is set.
- Response (documented by the vendor): `TrainName`, `CurrentStationCode`,
  `CurrentStationName`, `DelayInMin`, `UpdateTime`, `Data`[] with per-station
  `StationCode`, `StationName`, `ScheduleArrival`, `ScheduleDeparture`,
  `ActualArrival`, `ActualDeparture`, `Delay`, `DayCount`, `Distance`, `Platform`.
- Live probe returned the key-gated auth error as expected (endpoint is reachable).

### 4.2 etrain (`etrain.info`)

- Mobile web URL: `https://etrain.info/train/{slug}-{train_no}/live?date=YYYYMMDD`
  (server-rendered HTML; slug must match, e.g. `12301-RAJDHANI-EXPRES`).
- Reverse-engineered JSON endpoint: `POST https://etrain.info/ajax.php?q=runningstatus`
  with form fields `train={no}&trainname={text}` plus an auto-injected `reqID`/`reqCount`.
- **Warning:** the ajax endpoint is anti-bot gated — it currently returns a
  `{"error":"Some feature has been Changed/Upgraded..."}` message regardless of request
  shape (verified 3× today). Prefer the server-rendered `/live` page; treat ajax as
  fallback only. Classify the anti-bot body as an upstream error, not a parse failure.
- Covers the TripOzo engine that also powers several sister sites.

### 4.3 erail (`erail.in`)

- `https://erail.in/train-enquiry/{train_no}` — ASP.NET server-rendered HTML with the
  full schedule table and embedded JSON. Reachable here (full page download verified).
- Live status rendering on erail uses a **SignalR peer network** rather than plain HTML;
  the server-rendered page is a **schedule** source. Use it for the station list; mark
  actuals unavailable unless the embedded JSON carries them.
- Highest structural similarity to the existing `easemytrip` HTML adapter.

---

## 5. Tier C — documented, blocked from this sandbox

These are real, widely-used upstreams with well-documented payload shapes, but they are
not reachable from this environment (DNS/Cloudflare/Turnstile). Implement them
conservatively: any blocked response surfaces as `ProviderError::Upstream`, matching the
aggregator's existing degradation behaviour.

### 5.1 railmitra (`railmitra.com`)
- `https://www.railmitra.com/live-train-running-status/{train_no}` — server-rendered
  HTML, title confirmed reachable here. Full status table embedded server-side.

### 5.2 runningstatus (`runningstatus.in`)
- `https://runningstatus.in/status/{train_no}-on-{YYYYMMDD}` — Cloudflare-guarded
  (403 from this sandbox), but the structure is documented from Wayback snapshots and is
  the exact site the RSTGCN paper scraped for its open dataset (see §6). This is the
  primary-source site for the paper's data → worthwhile as a scraper.

### 5.3 trainspnrstatus (`trainspnrstatus.com`)
- `POST https://trainspnrstatus.com/api/fetch-live-status` with
  `{ "train_no": ..., "date": "YYYY-MM-DD" }` (shape from their web client bundle).
  Cloudflare Turnstile in front of the form; the JSON endpoint may still answer a plain
  POST. Payload fields documented from their React bundle: train name, running-day
  message, and a station table with scheduled/actual timestamps and platform.

### 5.4 railbeeps / NDTV (`api.railbeeps.com`)
- `GET https://api.railbeeps.com/api/getRunningStatus/api-key/{web_key}/trainno/{no}/date/{D MMM}` —
  public web API key hard-coded in NDTV's site bundle. JSON response with a station list.
  Host has no public DNS here, but this is a stable, long-lived NDTV backend.

---

## 6. Published research found (fan-out)

| Paper / repo | What it is | Value to this work |
|---|---|---|
| **RSTGCN** — *Chowdhury, Koley, Chakraborty, Ghosh* (IIT Kharagpur + ISI Kolkata, 2025), arXiv:2510.01262 | First open dataset covering the entire Indian railway network; delay data scraped from runningstatus.in, 1–30 Sept 2024: 3,892 trains, 4,735 stations, 9,336 track edges; avg arrival delay ≈ 51 min | Validates runningstatus.in as a real, scrapeable source; provides the delay-distribution ground truth to sanity-check our aggregator's outputs; GCN baselines for any future delay prediction. |
| **RIDE** — Elliker et al. (2026) | Open benchmark for train delay prediction | Comparison target for aggregation quality; not an endpoint. |
| **ntes-client** — x64vbhv/ntes-client (GitHub) | Working open-source client for the CRIS `AppServAnd` endpoint, including the AES/MD5 envelope | The exact crypto constants and message shape used for provider #3 (verified against live responses here). |
| **MultiFeatures** — S4tyendra/MultiFeatures | Python library reverse-engineering confirmtkt / redrail / ixigo request shapes incl. headers | Confirmed header requirements for redrail and the `okhttp` UA family for confirmtkt. |
| **TrainTrack** — Arkapravo-Ghosh/TrainTrack (GitHub) | Another scraping dataset project for Indian railways | Cross-check on which upstreams are scrapable long-term. |

Key insight: the peer-reviewed **RSTGCN** dataset was itself scraped from **runningstatus.in**
with plain HTTP — strong evidence that endpoint (#8) is a stable, primary-source target
even though this sandbox is Cloudflare-blocked.

---

## 7. Implementation plan (matches playbook / goibibo template)

Each provider is a deep-module crate `rust/crates/provider-<name>/` with:

- `Cargo.toml` — deps: `tt-provider-core`, `tt-provider-http`, `tt-mapper`, `serde`,
  `serde_json`, `urlencoding` (as the sibling providers use).
- `src/lib.rs` — re-exports: `Provider` struct + `create_<name>_provider()`,
  `map_<name>_payload()`, plus the date converter used by tests.
- `src/provider.rs` — `Provider { http: Arc<dyn HttpTransport> }` implementing
  `tt_provider_core::TrainStatusProvider`; `name()` returns the registry key;
  `enabled()` returns true (or key-gated for `indianrailapi`); `fetch_train_status()`
  builds the request, calls `fetch_provider_json`/`fetch_provider_text`, then maps.
- `src/map.rs` — `map_<name>_payload(json, options) -> Result<MappedStatus, ProviderError>`
  converting upstream JSON into `tt_mapper::ProviderStationRow` rows +
  `AssembleOptions`, then `assemble_mapped_status`.
- `tests/<name>.rs` — unit tests over the captured payload samples via
  `tt_provider_http::MockTransport` + `tt_mapper::to_wire_status`.

Per-provider specifics:

| Provider | name() key | enabled() | fetch transport | Mapping notes |
|---|---|---|---|---|
| confirmtkt | `confirmtkt` | true | JSON GET + query params | `delayArr` ints; `travelled` flag; `trainDataNotFound` → upstream not-found |
| redrail | `redrail` | true | JSON GET + the 10 headers | dual `HH:mm:ss` / ISO time parser; nullable delays; infer current station |
| ntes | `ntes` | true | JSON POST + AES envelope helper in provider-core | decrypt → parse `STNS[]`; `DARR/DDEP` actuals, `ETA/ETD` expected |
| indianrailapi | `indianrailapi` | only when `INDIANRAILAPI_API_KEY` set | JSON GET, key in URL | like railradar gating |
| etrain | `etrain` | true | HTML GET `/live` page | scrape table; anti-bot body → upstream error |
| erail | `erail` | true | HTML GET `/train-enquiry/{no}` | schedule HTML + embedded JSON |
| railmitra | `railmitra` | true | HTML GET | server-rendered table scrape |
| runningstatus | `runningstatus` | true | HTML GET | scrape; Cloudflare → upstream error |
| trainspnrstatus | `trainspnrstatus` | true | JSON POST | JSON body; Turnstile → upstream error |
| railbeeps | `railbeeps` | true | JSON GET + web key | fixed web key constant |

Wiring points (same as existing providers):

1. `rust/Cargo.toml` — add the 10 crates to `members`.
2. `crates/orchestrator/src/registry.rs` — add arms to `build_status_providers` match;
   pass `indianrailapi_api_key: Option<&str>` through the existing key param plumbing.
3. `crates/config/src/providers.rs` — add the new names to `KNOWN_PROVIDERS` and the
   desired run order to `DEFAULT_PROVIDER_ORDER`; update the `parse_list` tests that pin
   the current order. Keep key-gated `indianrailapi` out of the default order.
4. `crates/api-server/src/app.rs` — thread the new key through if plumbing requires.

## 8. Risks / open items

- **Anti-bot risk** (etrain, runningstatus, trainspnrstatus, railbeeps): each is guarded
  by Cloudflare/Turnstile/captcha or DNS blocks from this sandbox. Implemented endpoints
  will legitimately return `Upstream` errors from this environment; behaviour in
  production depends on egress. This is by design for an aggregator.
- **AES envelope** (ntes): crypto constants are fixed and confirmed live, but CRIS can
  rotate them without notice; keep them as a single module-level constant.
- **Key-gated** (indianrailapi): must not appear in the default provider order.
- **`DEFAULT_PROVIDER_ORDER` tests**: config tests assert the exact current order —
  adding names requires updating those assertions.
