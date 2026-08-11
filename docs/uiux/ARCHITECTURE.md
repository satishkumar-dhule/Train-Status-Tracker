# train-tracker UI/UX Re-architecture — Implementation Contract

Status: APPROVED (orchestrator). All implementation agents build to this document.
Derived from: `docs/uiux/02-…09-*.md` research briefs (see each section's rationale).

## 0. Non-negotiables for every agent

- **Never touch** `artifacts/api-server/`, `rust/`, `lib/trains-data/`, `lib/api-client-react/`, root `vitest.config.ts`, root `package.json`.
- **File ownership is exclusive.** Only edit files your brief lists. If you need a file you don't own, note it in your final report — the orchestrator reconciles. Never edit another agent's files.
- **Do not delete existing files** (old components/tests) unless your brief explicitly says so. Old files are deleted only in the hygiene wave.
- **Write tests** for every file you create (test = part of your deliverable). Coverage thresholds are lines/functions/statements ≥70, branches ≥65 (root `vitest.config.ts`).
- Typecheck scoped: `pnpm --filter @workspace/train-tracker run typecheck`.
- Run tests for your files only: `pnpm test -- <yourfiles>` from repo root (vitest filters by path).
- Follow existing code conventions: function components, `cn()` from `@/lib/utils`, no new deps, **no code comments** unless asked, lucide-react icons only, semantic status color never alone (always pair with icon/text).
- Stable testids **must be preserved verbatim** (see §9). New testids follow the list.
- Component files: `.tsx`, logic-only modules: `.ts`.

## 1. Design principles (evidence in docs/uiux/0[2-9])

1. **Answer first.** Lead with the fact the passenger asked (status/delay), not machinery. The current status of the train is the largest visual object, upper-left. (08-ia-cognitive-load)
2. **One glance, one question.** Hero shows only the primary answer + the single most important secondary fact. (04-data-viz)
3. **Discrete over continuous for status.** Replace the percentage progress bar with a discrete station-segmented strip (each segment = one station leg). (04-data-viz, 08-ia)
4. **Defer decisions the user didn't ask for.** Gateway/source becomes a tertiary, reveal-on-demand control, not a first-class selector. (08-ia)
5. **Trust is a first-class surface.** Freshness ("Updated 2 min ago") + provenance ("via NTES") always visible next to status; stale state labelled honestly; errors state what/why/what-to-do, never blame the user. (07-trust)
6. **Search guides, never nags.** No invalid-on-every-keystroke; validate format on blur, resolve positively once typing stops; recents live inside the dropdown; ≤6 suggestions; submit is never disabled (validate on submit and show a clear error instead). (06-search-form-ux)
7. **Motion is meaningful, not decorative.** Skeleton+shimmer (not spinner), with a ~200ms on-delay; silent polling (no animation on every poll, only on real diffs); 150–400ms durations; respect `prefers-reduced-motion` for all motion. (02-motion)
8. **Accessibility baseline (WCAG 2.2 AA).** Text ≥4.5:1, non-text ≥3:1, APCA-aware (no muted-on-muted); run-date picker is a segmented single-select (`aria-pressed`), NOT `role=tab`; focus-visible rings; 44px touch targets; live regions for status changes; skip link. (03-accessibility)
9. **DRY at the seam, not the surface.** Extract only small stable primitives (Card, Stat, Pill, Label, Button, Skeleton, LiveRegion). Rule of three: a third repeated use justifies a primitive. (05-design-systems)
10. **KISS + deep modules.** Each feature owns its state machine; pages compose, never compute. Interfaces are narrow; one file one concern. (codebase-design skill vocabulary: module, interface, seam, adapter, depth, leverage)

## 2. Target tree (new/changed files)

```
artifacts/train-tracker/src/
├── index.css                        # +semantic status tokens, +motion tokens, reduced-motion gate   [A1]
├── lib/
│   ├── theme.ts                     # NEW motion + reduced-motion helpers                              [A1]
│   ├── format.ts                    # NEW consolidated formatters (DRY)                                [A3]
│   └── (status-metrics, api-monitoring, validation, status-cache, api-client, env,
│        recent-searches, providers, utils: KEEP as-is — deep modules, may be composed)
├── components/primitives/
│   ├── index.ts                     # barrel                                                                  [A2]
│   ├── button.tsx                   # variant-enumerated                                                       [A2]
│   ├── card.tsx                                                                                                [A2]
│   ├── label.tsx                    # mono uppercase label treatment (currently repeated)                       [A2]
│   ├── pill.tsx                     # status + neutral variants (color+icon, never color alone)                 [A2]
│   ├── stat.tsx                     # label/value/sub/tone + hero flag                                           [A2]
│   ├── skeleton.tsx                 # shimmer, ~200ms on-delay                                                 [A2]
│   └── live-region.tsx              # role="status" helper                                                      [A2]
├── features/
│   ├── search/
│   │   ├── search-slice.ts          # pure logic: suggestions+recents, validation timing, submit flow          [A9]
│   │   ├── search-box.tsx           # combobox, owns keyboard + a11y                                            [A10]
│   │   └── recent-trains.tsx        # labeled recents group inside dropdown                                     [A10]
│   ├── journey/
│   │   ├── journey-slice.ts         # deep module: runs + status + refresh + auto-refresh state machine        [A11]
│   │   ├── journey-view.tsx         # answer-first stratified composition                                       [A14]
│   │   ├── journey-route.tsx        # discrete station-segmented progress strip                                [A4]
│   │   ├── station-timeline.tsx     # linear timeline + "All stations" disclosure                              [A5]
│   │   ├── run-selector.tsx         # segmented single-select, aria-pressed                                    [A6]
│   │   ├── source-notes.tsx         # freshness + provenance + stale/refreshing                                [A7]
│   │   └── journey-states.tsx       # skeleton / error / empty (not-scheduled)                                 [A8]
│   └── monitoring/
│       └── monitoring-view.tsx      # swap to primitives + keep probe/table/panel structure                   [A12]
├── pages/
│   ├── Home.tsx                     # compose search + journey via slices                                     [B1]
│   ├── Monitoring.tsx               # compose monitoring slice                                                [B1]
│   └── App.tsx                      # skip link, providers, router, bottom nav                                [B1]
└── hooks/ + context/ + components/(old): superseded files deleted in hygiene wave [B2]
```

Ownership: A1–A14 = wave 1 (leaf, parallel). B1–B3 = wave 2 (composition/hygiene/tests). No two agents write the same file.

## 3. Theme & motion — A1 (`index.css`, `lib/theme.ts`)

Keep the existing CSS-variable + `html.inverted` mechanism and Tailwind `@theme` block. Extend:

- **Semantic status tokens** (Tailwind `@theme` colors referencing HSL vars, e.g. `--color-on-time`, `--color-late`, `--color-cancelled`, `--color-stale`, each with `-fg`). Pick hues from a green/amber/red/zinc family that are WCAG-AA on the card surface when used as Pill fills (light + inverted). Current light `--muted-foreground` `0 0% 42%` is below APCA-safe on card — bump light to `0 0% 46%` and dark to `0 0% 64%` so muted text is readable (03-accessibility §muted).
- **Motion tokens**: `--motion-fast:150ms`, `--motion-base:250ms`, `--motion-slow:400ms` + easing var. Used by `lib/theme.ts` helpers.
- **Reduced-motion gate**: a global `@media (prefers-reduced-motion: reduce)` rule disabling transitions/animations, plus Tailwind-safe approach for JS-driven animation (CSS only, no JS timers for polish).
- **Skeleton shimmer**: CSS-only keyframes; container delays children by ~200ms via `animation-delay` so skeletons appear after the quiet-while-fast threshold.
- **Focus**: `:focus-visible` ring token + component-level `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` convention.
- **Skip link**: styles for `[data-skip-link]` (visually hidden until focused).
- `lib/theme.ts` (with `lib/theme.test.ts`): export `motion = { fast, base, slow, easings }`, `useReducedMotion(): boolean` (matchMedia listener), `useInverted` may stay in existing `use-inverted.ts` (do not duplicate — leave that file to its owner). This file is the ONLY place motion values live (DRY).

Preserve: all existing custom classes used by old components (they still render until hygiene wave deletes them). Add, don't remove.

## 4. Primitives — A2 (`components/primitives/*`)

Presentational only, no imports from hooks/lib/features. Variant-enumerated props (no free-form `variant` strings beyond the declared union). All use `cn`. Tests: `components/primitives/*.test.tsx`.

- `Button` — `variant: "primary"|"secondary"|"outline"|"ghost"|"danger"`, `size: "sm"|"md"|"lg"` (min 44px hit area for touch unless `size="sm"` is explicitly for inline rows), forwards `ref`, accepts `aria-pressed`/`aria-label`, `data-testid`. Keep a `data-testid` pass-through.
- `Card` — `as?: "div"|"section"|"article"`, `padding?: "sm"|"md"|"lg"|"none"`. Default md.
- `Label` — the repeated `font-mono text-[10px] uppercase tracking-widest` heading treatment + optional `tone` (muted/default).
- `Pill` — `variant: "on-time"|"late"|"cancelled"|"stale"|"neutral"|"info"`, `icon?: ReactNode` (used for on-time ✓, late ⚠, cancelled ✕ so color is never the only signal), `size: "sm"|"md"`. Renders `<span role="status">` when used as a live status indicator. Replace existing delay-badge + status-pill duplication.
- `Stat` — `{ label, value, sub?, tone?: "neutral"|"success"|"warning"|"destructive"|"muted", hero?: boolean, testId? }`. Hero = `text-5xl font-bold tracking-tight` (the delay answer). Non-hero values `text-2xl`.
- `Skeleton` — `{ lines?: number; className?: string }`, CSS shimmer, ~200ms delay, respects reduced-motion.
- `LiveRegion` — `<div role="status" aria-live="polite" className="sr-only">` wrapper for announce-on-change.

Deliverable includes updating `gateway-selector.tsx`, `invert-toggle.tsx`, `monitoring-view.tsx`, `search-box.tsx` to use primitives IF those files are yours (they are not — A2 only creates primitives + their tests; the refactor of existing files happens in A10/A12/B2). A2's primitives must be usable by consumers without A2 touching consumer files.

## 5. Format module — A3 (`lib/format.ts`)

Single DRY home for presentation formatters, migrating duplicated bodies OUT of existing libs (do NOT delete the originals — B2 hygiene removes the duplicates after pages stop importing them). Move implementations of:

- `formatLatency`, `formatBytes`, `formatUptime`, `formatStatusCode`, `formatRelativeTime` (currently in `lib/api-monitoring.ts` — keep thin re-exports there to avoid breaking monitoring-view until B2).
- `formatDuration`, `formatShortDate` (trains-data wrappers).
- New: `formatStationName` (from `providers.ts` `formatProviderName` style), `formatDelayPhrase(min: number|null)` → `"On time" | "45 min late" | "45 min early"`, `formatDistance(km: number|null)`.

`lib/format.ts` re-imports from `@workspace/trains-data` for date/duration primitives (adapter seam). Tests: `lib/format.test.ts`. Existing `lib/api-monitoring.ts` and `lib/providers.ts` keep working unchanged.

## 6. Journey pieces — A4–A8 (`features/journey/*`)

All pure-presentational, data-driven via props from `journey-view`. Do NOT import data hooks.

### A4 `journey-route.tsx`
Discrete station-segmented strip (replaces percent `progress-bar`). Props: `{ stations: StatusStationLike[], currentIndex: number | null, nextIndex: number | null }`. Renders one segment per station leg; segments before current = filled (on-time color), segment at current = pulsing marker dot (respect reduced-motion), ahead = muted. Each station gets a tick. Above the strip: station names for origin / current / destination at the extremes. No bar-fill, no percentage text. testids: `journey-route`, `route-marker`, `route-segment-{code}`.

### A5 `station-timeline.tsx`
Keeps the current timeline row structure (scheduled/actual time, PF, day, delay) but adds progressive disclosure: props `{ stations, maxVisible = 7, showAll, onToggleShowAll }`. When `stations.length > maxVisible`, render the nearest stations around `currentIndex` (current ± 2) and collapse the rest behind a `Button variant="ghost"` "Show all N stations" / "Show fewer". Testids preserved: `station-timeline`, `row-station-{code}`. Rows never animate on poll.

### A6 `run-selector.tsx`
Segmented single-select of run dates. Props: `{ dates: RunTab[] }` where `RunTab = { apiDate, iso, label, isDefault, isSelected }`, `onSelect(apiDate)`. Use `aria-pressed` buttons grouped in a `role="group"` with `aria-label="Departure date"` — NOT `role=tab`/`tablist`. Preserve testids: `run-selector`, `tab-date-{apiDate}`. Label non-default dates (e.g. "Jul 29") with the weekday short form; default recommended date keeps `isDefault` marker (a small "Recommended" hint via Pill neutral or just the existing dot). Highlight ring on selected via focus-visible + aria-pressed styling (selected ≠ tab-focus).

### A7 `source-notes.tsx`
The trust surface. Props: `{ updatedLabel: string|null, providerLabel: string|null, refreshing: boolean, stale: boolean }`. Renders one line: "Updated {updatedLabel} · via {providerLabel}" plus a "Refreshing…" indicator when `refreshing`, and a StalePill (variant `stale`) when `stale` (placeholder data). Preserve testids: `status-updated`, `status-provider`, `status-refreshing`. Add container testid `source-notes`. Honest intervals: derived from `data.updated_at` (status view already computes) — no fabricated precision.

### A8 `journey-states.tsx`
- `JourneySkeleton` — Card + `Skeleton` lines (uses 200ms-delay shimmer). testid `status-skeleton`.
- `JourneyError` — props `{ errorType: "not-found"|"provider"|"network"|null, trainNumber, onRetry }`. Copy per 07-trust: what happened, why, what to do next; `not-found` → "We couldn't find {number} on {date}. Double-check the number or try another date."; provider → "The schedule source for {number} is unavailable right now. Try again in a moment."; network → "We couldn't reach the schedule service. Check your connection and retry." Never "you did something wrong". Retry = `Button`. Preserve testids `status-error`, `status-retry`.
- `JourneyEmpty` — not-scheduled variant, distinct from loading: "No departure scheduled for {number} on {date}" + CTA to pick another run date (calls `onSelectDate`). testid `status-empty`.

## 7. Search — A9, A10 (`features/search/*`)

### A9 `search-slice.ts` (pure logic, no React DOM)
Reuse `lib/validation.ts`, `@workspace/trains-data` `searchTrains`/`scoreTrain`/`uniqueByNumber`, and `context/recent-searches` `useRecentSearches` (via an injected adapter function so the module stays pure and unit-testable). Interface:

```ts
interface SuggestionItem {
  id: string                 // `suggest-{trainNumber}` | `recent-{trainNumber}`
  trainNumber: string
  trainName: string
  type: "catalog" | "recent"
  highlight: { number: number[]; name: number[] }   // index pairs for <mark>, via splitHighlight
}
function buildSuggestions(value: string, trains: TrainEntry[], recents: string[]): SuggestionItem[]
// value < MIN_QUERY_LENGTH(2): recents group ONLY (labeled, capped 5) → type "recent"
// else: catalog matches ranked ≤6 (existing scoring); recents NOT interleaved
```

- `validationPhase(state, opts)`: idle → typing → valid/invalid. Format check runs on blur, not every keystroke; once a value was invalid-on-blur it re-validates live as the user edits. Submit is never blocked by the UI: `submit(trainNumber, date)` re-runs full validation and returns `{ ok: true }` or `{ ok: false, reason: "format"|"not-found" }` for the box to surface.
- Keep the existing flow contract that `useTrainSearch` (in `hooks/use-train-search.ts`, KEEP that file, it's the owned state machine) satisfies; `search-slice.ts` provides the pure helpers it needs. Do not rewrite `use-train-search.ts`.

Tests: `features/search/search-slice.test.ts` (suggestions grouping/cap/rank, validation timing states, submit behavior).

### A10 `search-box.tsx` + `recent-trains.tsx`
- Keep the existing APG combobox markup/behaviour (from current `search-box.tsx` + `use-train-autocomplete.ts`, which stays).
- **Change 1:** when input is empty/very short, render `RecentTrains` group inside the dropdown (`role="listbox"`), labeled "Recent" via `role="group"` + `aria-label`, items `recent-row-{number}` testid, using recents from the recents context (capped 5, most-recent-first). Selecting one calls `handleSelectRecent`.
- **Change 2:** validation indicators only appear on blur (or after failed submit), not mid-typing; keep `status-valid`/`status-invalid` testids.
- **Change 3:** submit button is always enabled (remove `aria-disabled`+opacity gating); on invalid submit, show inline error + focus input. Keep `submit-train-search`, `input-train-number`, `list-train-suggestions`, `clear-train-number` testids.
- **Change 4:** suggestion count announced via `LiveRegion` ("6 suggestions for 229").

Tests: `features/search/search-box.test.tsx`, `features/search/recent-trains.test.tsx`. Preserve existing `search-box.test.tsx` behaviour where valid (A10 owns the NEW files; the OLD `components/search-box.test.tsx` is deleted in B2 and its still-valid assertions re-created here).

## 8. Journey slice — A11 (`features/journey/journey-slice.ts`)

The deep module that replaces the orchestration currently inside `pages/Home.tsx`. Consumes existing hooks (`use-train-runs`, `use-train-status`, `use-train-providers`, `use-train-catalog`) — do not modify them. Exports `useJourney(trainNumber: string | null)` returning a narrow interface:

```ts
interface JourneySlice {
  selected: { trainNumber: string; departureDate: string } | null
  runs: string[] | undefined
  runsError: boolean
  dates: RunTab[]                       // from runs + getUpcomingDates, "auto"/default via pickDefaultRunDate
  activeDate: string
  selectDate(apiDate: string): void     // sets userPickedDate=true
  userPickedDate: boolean
  gateway: string                       // GATEWAY_AUTO default
  setGateway(g: string): void
  gateways: string[]
  status: TrainStatusResult             // { data, isLoading, isFetching, isPlaceholderData, isError, errorType, refetch }
  refresh(): void
  autoRefresh: { enabled: boolean; cadenceMs: number; setEnabled(b: boolean): void; setCadence(ms: number): void }
}
```

- `autoRefresh` defaults: enabled=false (autonomy is opt-in per research 09), cadence default `5 * 60_000`. When enabled, silent re-fetch every cadence; it must be visible + stoppable in the UI (journey-view's source-notes area or refresh row gets a "Live" toggle). Polling must not trigger focus/animation; only on data diff (isPlaceholderData flip).
- Status is fetched only when `selected` is set. errorType derived exactly as current Home does (query error → "provider"; invalid response → "not-found"; fetch throw → "network").
- Tests: `features/journey/journey-slice.test.tsx` via a lightweight harness (mock hooks with vi.mock) asserting: date tabs built from runs, default date = pickDefaultRunDate, selectDate sets userPickedDate, auto-refresh opt-in default off and toggles, silent refresh does not churn state.

## 9. Testid contract (stable — must exist verbatim)

Preserve exactly: `status-skeleton`, `journey-summary`, `next-stop-card`, `progress-bar`, `progress-bar-fill`, `station-timeline`, `row-station-{code}`, `status-error`, `status-retry`, `status-message`, `train-identity-hero`, `text-train-number`, `text-train-name`, `status-provider`, `status-refreshing`, `status-updated`, `button-refresh`, `input-train-number`, `status-valid`, `status-invalid`, `clear-train-number`, `list-train-suggestions`, `submit-train-search`, `run-selector`, `tab-date-{apiDate}`, `gateway-selector`, `select-gateway`, `recent-chip-{number}`, `recent-chip-name-{number}`, `button-invert`, `monitoring-endpoints`, `monitoring-row-{probe}`, `monitoring-latency-{probe}`, `monitoring-provider-{name}`, `monitoring-providers`, `monitoring-loading`, `monitoring-summary`, `monitoring-live`, `monitoring-pause`, `monitoring-refresh`, `monitoring-outage`, `monitoring-back`, `search-form`.

New: `journey-route`, `route-marker`, `route-segment-{code}`, `source-notes`, `status-empty`, `search-recents`, `recent-row-{number}`, `search-results-count`, `all-stations-toggle`, `live-status-toggle`.

Note: `progress-bar` is asserted by the existing `status-view.test.tsx` — the discrete strip's wrapper must carry `data-testid="progress-bar"` (and an accessible name) so that test keeps passing until B2 migrates it. `progress-bar-fill` is not test-asserted; optional.

## 10. Monitoring — A12 (`features/monitoring/monitoring-view.tsx`)

Same data layer (`use-api-monitoring`, keep hook). Rebuild presentation using primitives: `Stat` for summary bullets, `Pill` for statuses, `Label` for section headers, `Button` for pause/refresh. Keep: sparklines, endpoint table (`monitoring-row-*`), provider cards, outage banner, printed current latency/uptime values beside sparklines (research 04: lead with the number). Preserve all `monitoring-*` testids. Add a `format*` usage via `@/lib/format`. Tests: rewrite `features/monitoring/monitoring-view.test.tsx` (new file) preserving current assertions; old `components/monitoring-view.test.tsx` deleted in B2.

## 11. Journey view — A14 (`features/journey/journey-view.tsx`)

Stratified answer-first composition (research 08/04). Order on screen, top to bottom:

1. **Status hero** (`train-identity-hero`): the delay answer as a `Stat hero` — e.g. "On time" or "45 min late" (via `formatDelayPhrase` + Pill) — plus compact identity line (`text-train-number`, `text-train-name`, route string), `button-refresh`, and `SourceNotes`. Largest object, upper-left.
2. **Next stop + ETA** (`next-stop-card`): next station name, ETA, platform, and the journey summary stats row (`journey-summary`): origin→destination, total duration, stops count — composed with `Stat` (non-hero).
3. **Journey route strip** (`journey-route`) — A4.
4. **Run selector** (`run-selector`) — A6, directly above the timeline so changing dates is near the schedule.
5. **Station timeline** (`station-timeline`) with disclosure — A5.
6. **Gateway/source** demoted: a `<details>`-style "Data source" disclosure (or tertiary ghost button) that reveals `GatewaySelector` (`gateway-selector`, `select-gateway` testids preserved) defaulting to `GATEWAY_AUTO`. Placed last, below timeline, `aria-expanded` managed.
7. States: `JourneySkeleton` while loading, `JourneyError` on error, `JourneyEmpty` for not-scheduled — A8.

Data via `useJourney` (A11) only. Owns `data-testid` wrapping and the auto-refresh "Live" toggle (`live-status-toggle`) wired to `autoRefresh`. Tests: `features/journey/journey-view.test.tsx` covering render order (hero before next-stop), skeleton/error/empty delegation, source notes rendering, gateway reveal. Reuse status-view's data-shape fixtures.

## 12. Composition wave — B1 (`pages/Home.tsx`, `pages/Monitoring.tsx`, `App.tsx`)

- `Home.tsx`: becomes a thin composition — search slice (A9/A10) + `JourneyView` (A14) fed from `useTrainSearch` state. Move orchestration out (it now lives in A11). Preserve `button-new-search`, `header-train-number`, `button-invert`, nav behaviours. `home.test.tsx` updated to match (B3's responsibility) — B1 must keep `home.test.tsx` compiling (may edit it, it's yours in the map, or leave a note).
- `Monitoring.tsx` + `App.tsx`: minimal — compose monitoring view; add skip link (`data-skip-link`), main landmark, keep routing (wouter) + `RecentSearchesProvider`. Keep `monitoring-back`, `nav-link-monitoring` testids.
- B1 owns: `pages/Home.tsx`, `pages/Monitoring.tsx`, `App.tsx`, `pages/home.test.tsx`, `pages/monitoring.test.tsx`.

## 13. Hygiene wave — B2 (delete superseded files)

After B1 lands, delete (moved logic now lives in features/): `components/status-view.tsx`, `components/status-skeleton.tsx`, `components/delay-badge.tsx`, `components/search-box.tsx`, `components/recent-chips.tsx`, `components/run-selector.tsx`, `components/gateway-selector.tsx`, `components/monitoring-view.tsx`, `hooks/use-train-autocomplete.ts` (logic re-homed in search-slice) **iff nothing imports them**. Before deleting each: `rg "<import"` — if B1 or A-agents still import, fix the import target to the feature file first (B2 owns those deletions; coordinate in report). Do NOT delete: `use-inverted.ts`, `use-recent-searches.ts`, `context/`, `lib/*` (except dedupe the moved formatter bodies from api-monitoring/providers, keeping re-exports). Also delete stale tests: `components/status-view.test.tsx`, `components/search-box.test.tsx`, `components/recent-chips.test.tsx`, `components/run-selector.test.tsx`, `components/gateway-selector.test.tsx`, `components/monitoring-view.test.tsx` (A10/A12 re-created equivalents in features/). Update `components/invert-toggle` if it referenced moved types. Verify: full `pnpm run typecheck` + full `pnpm test`.

## 14. Verification (B3 + orchestrator)

- `pnpm --filter @workspace/train-tracker run typecheck`
- `pnpm test` — expected: all pass EXCEPT the pre-existing 3 failures in `artifacts/api-server/src/routes/train-runs.test.ts` (date-fixture drift; unrelated, known, leave untouched).
- Coverage: root `pnpm test --coverage` — thresholds lines/functions/statements 70, branches 65, enforced for changed files.
- B3 final pass: run full suite, fix integration issues across seams, report remaining.

## 15. Agent briefs

Wave 1 (parallel, independent files):
A1 theme+motion; A2 primitives; A3 format; A4 journey-route; A5 station-timeline; A6 run-selector; A7 source-notes; A8 journey-states; A9 search-slice; A10 search-box+recent-trains; A11 journey-slice; A12 monitoring-view; A14 journey-view.

Wave 2: B1 composition; B2 hygiene; B3 verification.

(§6 A13 slot unused — journey-view is A14 to keep numbering stable with the research docs' numbering style.)
