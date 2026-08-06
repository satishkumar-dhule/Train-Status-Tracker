import { useEffect, useMemo } from "react";
import type {
  StationStatus,
  TrainStatusResponse,
} from "@workspace/api-client-react";
import {
  formatShortDate,
  fromApiDate,
  getUpcomingDates,
  pickDefaultRunDate,
  toApiDate,
} from "@workspace/trains-data";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  MapPin,
  TrainFront,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import {
  computeDurationMinutes,
  computeProgressPercent,
  findCurrentStation,
} from "@/lib/status-metrics";
import { Badge, Button } from "@/components/ui";
import { SearchForm } from "@/components/search-form";
import { LanguageSwitcher } from "@/components/language-switcher";
import { DisplaySettings } from "@/components/display-settings";
import { TrainIllustration } from "@/components/TrainIllustration";
import { RecentChips } from "@/components/recent-chips";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { useTrainStatus } from "@/hooks/use-train-status";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useTrainRuns } from "@/hooks/use-train-runs";
import { useTrainCatalog } from "@/hooks/use-train-catalog";
import { useTrainSearch } from "@/hooks/use-train-search";
import { DateTabs } from "@/components/status/date-tabs";
import { DelayBadge } from "@/components/status/delay-badge";
import { JourneySummary } from "@/components/status/journey-summary";
import { NextStopCard } from "@/components/status/next-stop-card";
import { ProgressBar } from "@/components/status/progress-bar";
import { StationTimeline } from "@/components/status/station-timeline";
import { StatusMessage } from "@/components/status/status-message";
import { StatusSkeleton } from "@/components/status/status-skeleton";
import { TrackView } from "@/components/status/track-view";
import { ViewToggle } from "@/components/status/view-toggle";
import { RefreshControls } from "@/components/status/refresh-controls";
import { useViewPreference } from "@/hooks/use-view-preference";

/** A running-status payload stops being "live" once it is this old. */
const LIVE_DATA_TTL_MS = 5 * 60 * 1000;

function TrainIdentityBlock({
  data,
  stations,
}: {
  data: TrainStatusResponse;
  stations: StationStatus[];
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h1
          className="text-2xl md:text-3xl font-mono font-bold text-primary"
          data-testid="text-train-number"
        >
          {data.train_number}
        </h1>
        <Badge
          variant="outline"
          className="text-muted-foreground border-primary/40 bg-primary/5 font-mono text-sm tracking-widest"
          data-testid="text-train-name"
        >
          {data.train_name}
        </Badge>
      </div>
      <div className="text-sm font-mono text-muted-foreground flex items-center gap-2 tracking-wide flex-wrap">
        <MapPin className="w-3.5 h-3.5" />
        <span>{data.source_station_name}</span>
        <span className="text-muted-foreground">→</span>
        <span>{data.destination_station_name}</span>
        {stations[0]?.scheduled_departure &&
          stations[stations.length - 1]?.scheduled_arrival && (
            <span className="text-xs text-muted-foreground">
              · {stations[0].scheduled_departure} →{" "}
              {stations[stations.length - 1].scheduled_arrival}
            </span>
          )}
      </div>
    </div>
  );
}

export default function Home() {
  const { t } = useI18n();
  const { recent, addRecent } = useRecentSearches();
  const { trains } = useTrainCatalog();
  const [view, setView] = useViewPreference();
  const [autoRefresh, setAutoRefresh] = useAutoRefresh();

  const {
    trainNo,
    setTrainNo,
    trainValidity,
    setTrainValidity,
    selectedTrain,
    setSelectedTrain,
    headerNo,
    setHeaderNo,
    headerValidity,
    setHeaderValidity,
    headerSelected,
    setHeaderSelected,
    searched,
    apiParams,
    userPickedDate,
    handleSearchFormSubmit,
    handleSelectRecent,
    handleResultsSearch,
    selectDate,
    setDepartureDate,
    reset,
  } = useTrainSearch({ trains, addRecent });

  const {
    runs,
    isError: runsError,
  } = useTrainRuns(searched ? apiParams.train_number : null);

  // Once the train's runs are known, land on a run date: today when the train
  // runs today, otherwise the most recent past run (or the next run). Never
  // overrides a date the user picked manually.
  useEffect(() => {
    if (!searched || userPickedDate) return;
    const recommended = runs && runs.length > 0 ? pickDefaultRunDate(runs) : null;
    if (recommended && recommended !== apiParams.departure_date) {
      setDepartureDate(recommended);
    }
  }, [searched, userPickedDate, runs, apiParams.departure_date, setDepartureDate]);

  // Date tabs come exclusively from the train's run dates: the last 3 runs up
  // to today plus the next run. No calendar-window fallback, so a day the
  // train does not run on can never appear here.
  const dates = useMemo(() => {
    if (!runs || runs.length === 0) return [];
    const todayApi = toApiDate(getUpcomingDates(1)[0]);
    const past = runs.filter((r) => r <= todayApi);
    const future = runs.filter((r) => r > todayApi);
    const windowIso = [
      ...past.slice(Math.max(0, past.length - 3)),
      ...future.slice(0, 1),
    ].map(fromApiDate);
    const latestRunApi = past.length ? past[past.length - 1] : null;
    const nextRunApi = future[0] ?? null;

    return windowIso.map((iso) => {
      const apiDate = toApiDate(iso);
      const isLatest = apiDate === latestRunApi;
      const isNext = apiDate === nextRunApi;
      return {
        iso,
        apiDate,
        label: isLatest
          ? t("label.latestRun")
          : isNext
            ? t("label.nextRun")
            : formatShortDate(iso),
        sub: isLatest || isNext ? formatShortDate(iso) : undefined,
      };
    });
  }, [t, runs]);

  // The running-status query must never target a day the train does not run
  // on. While run dates are still loading it is held; when discovery failed or
  // returned no schedule (runs empty) we fail open on the selected date so the
  // app stays usable.
  const runsKnown = runs !== undefined;
  const statusEnabled =
    searched &&
    (runsError ||
      (runsKnown &&
        (runs.length === 0 ||
          runs.includes(apiParams.departure_date))));

  const { data, isLoading, isFetching, isError, isPlaceholderData, messageKey, refetch } =
    useTrainStatus(searched ? apiParams : null, statusEnabled, autoRefresh);

  // While the status query is held (run dates still loading, or the selected
  // date not yet resolved onto a run day) show a skeleton instead of nothing.
  const statusPending = searched && statusEnabled === false;

  /** A status payload is only "live" while it is current AND freshly updated. */
  const isLiveData =
    !!data &&
    !isPlaceholderData &&
    !!data.last_updated &&
    Date.now() - Date.parse(data.last_updated) <= LIVE_DATA_TTL_MS;

  const handleRefresh = () => {
    void refetch();
  };

  // Derived journey facts from the running-status payload.
  const stations = data?.stations ?? [];
  const currentStation = findCurrentStation(stations);
  const totalDistance =
    stations[stations.length - 1]?.distance_from_source ?? null;
  const currentDistance = currentStation?.distance_from_source ?? null;
  const progressPercent = computeProgressPercent(
    currentDistance,
    totalDistance,
  );
  const durationMinutes = computeDurationMinutes(
    { scheduled_departure: stations[0]?.scheduled_departure },
    { scheduled_arrival: stations[stations.length - 1]?.scheduled_arrival },
  );

  const errorKey: Key =
    messageKey === "error.trainNotFound" ||
    messageKey === "error.providerUnreachable" ||
    messageKey === "error.fallback"
      ? messageKey
      : "error.fallback";

  // PAGE 1 — Search
  if (!searched) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <header className="bg-primary text-primary-foreground h-14 sticky top-0 z-40">
          <div className="max-w-3xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="shrink-0 w-9 h-9 rounded-lg bg-primary-foreground/15 flex items-center justify-center">
                <TrainFront className="w-5 h-5 text-primary-foreground" />
              </span>
              <span className="font-sans font-semibold text-lg md:text-xl text-primary-foreground truncate">
                {t("app.title")}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <DisplaySettings className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/15" />
              <LanguageSwitcher className="text-primary-foreground" />
            </div>
          </div>
        </header>

        <main className="flex-1 w-full">
          <section className="bg-gradient-to-b from-brand-soft/70 via-brand-soft/25 to-background">
            <div className="max-w-3xl mx-auto px-4 pt-10 md:pt-14 text-center">
              <h1
                className="font-sans text-3xl md:text-4xl font-bold text-primary"
                data-testid="search-title"
              >
                {t("label.searchTitle")}
              </h1>
              <p className="mt-2 font-sans text-muted-foreground">
                {t("app.tagline")}
              </p>
            </div>
            <TrainIllustration className="mx-auto w-full max-w-2xl -mb-4" />
          </section>

          <div className="px-4">
            <div className="max-w-xl mx-auto bg-card border border-card-border rounded-2xl shadow-lg shadow-primary/5 p-5 md:p-6">
              <label
                htmlFor="trainNo"
                className="block text-sm font-medium text-foreground mb-2"
              >
                {t("label.trainNumber")}
              </label>
              <SearchForm
                id="trainNo"
                value={trainNo}
                onValueChange={setTrainNo}
                onValidityChange={setTrainValidity}
                onSelectedChange={setSelectedTrain}
                onSubmit={handleSearchFormSubmit}
                autoFocus
              />
            </div>

            {recent.length > 0 && (
              <section
                className="mt-6 animate-fade-up"
                data-testid="recent-searches"
              >
                <div className="max-w-xl mx-auto">
                  <h2 className="font-mono text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> {t("label.recent")}
                  </h2>
                  <RecentChips recent={recent} onSelect={handleSelectRecent} />
                </div>
              </section>
            )}
          </div>
        </main>

        <footer className="py-6 text-center text-sm text-muted-foreground">
          Indian Railways · रेल सारथी
        </footer>
      </div>
    );
  }

  // PAGE 2 — Results
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="bg-primary h-14 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-3 md:px-6 h-14 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={reset}
            className="shrink-0 h-11 w-11 text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/15"
            aria-label={t("action.abortReturn")}
            data-testid="button-new-search"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="min-w-0 flex-1 flex items-center gap-2">
            {data ? (
              <>
                <span
                  className="font-mono text-lg font-semibold text-primary-foreground truncate"
                  data-testid="header-train-number"
                >
                  {data.train_number}
                </span>
                <span className="hidden sm:inline text-sm text-primary-foreground/80 truncate">
                  {data.source_station_code} → {data.destination_station_code}
                </span>
              </>
            ) : (
              <div
                className="flex items-center gap-2 min-w-0"
                data-testid="header-train-skeleton"
              >
                <div className="h-6 w-14 shrink-0 rounded bg-primary-foreground/20 animate-pulse" />
                <div className="hidden sm:block h-4 w-40 rounded bg-primary-foreground/20 animate-pulse" />
              </div>
            )}
          </div>

          {data && (
            <div
              className="shrink-0"
              data-testid="status-delay-badge"
            >
              <DelayBadge delayMinutes={data.current_delay_minutes ?? null} />
            </div>
          )}

          <DisplaySettings className="shrink-0 text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/15" />
          <LanguageSwitcher iconOnly className="shrink-0 text-primary-foreground" />
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="hidden md:block">
            <SearchForm
              id="results-search"
              compact
              autoFocus={false}
              value={headerNo}
              onValueChange={setHeaderNo}
              onValidityChange={setHeaderValidity}
              onSelectedChange={setHeaderSelected}
              onSubmit={handleResultsSearch}
              data-testid="results-search-form"
            />
          </div>

          {data && (
            <div
              className="space-y-3 animate-fade-up bg-card border border-card-border rounded-2xl p-4 md:p-5 shadow-sm"
              data-testid="train-identity-hero"
            >
              <TrainIdentityBlock data={data} stations={stations} />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  {isPlaceholderData ? (
                    <div className="text-xs text-muted-foreground font-mono flex items-center gap-1 uppercase tracking-widest">
                      <Clock className="w-3.5 h-3.5 animate-spin" />
                      {t("status.refreshing")}
                    </div>
                  ) : (
                    data.last_updated && (
                      <div className="text-xs text-muted-foreground font-mono flex items-center gap-1 uppercase tracking-widest">
                        <Clock className="w-3.5 h-3.5" />
                        {t("status.updated", {
                          time: new Date(data.last_updated).toLocaleTimeString(
                            [],
                            { hour: "2-digit", minute: "2-digit" },
                          ),
                        })}
                      </div>
                    )
                  )}
                </div>
                <RefreshControls
                  isFetching={isFetching}
                  autoRefresh={autoRefresh}
                  onRefresh={handleRefresh}
                  onAutoRefreshChange={setAutoRefresh}
                />
              </div>
            </div>
          )}

          {dates.length > 0 && (
            <div>
              <DateTabs
                dates={dates}
                active={apiParams.departure_date}
                onChange={selectDate}
              />
            </div>
          )}

          {data ? (
            <div
              key={`${apiParams.train_number}-${apiParams.departure_date}`}
              className="space-y-4 md:space-y-6 animate-fade-up"
            >
              <StatusMessage message={data.status_message ?? null} />
              <JourneySummary
                currentStation={currentStation}
                totalDistance={totalDistance}
                currentDistance={currentDistance}
                durationMinutes={durationMinutes}
                scheduledDeparture={stations[0]?.scheduled_departure ?? null}
                scheduledArrival={
                  stations[stations.length - 1]?.scheduled_arrival ?? null
                }
                stationCount={stations.length}
              />
              <ProgressBar
                percent={progressPercent}
                sourceCode={data.source_station_code}
                destinationCode={data.destination_station_code}
              />
              <NextStopCard
                stations={stations}
                currentDistance={currentDistance}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("label.view")}
                </span>
                <ViewToggle value={view} onChange={setView} />
              </div>
              {view === "track" ? (
                <TrackView stations={data.stations} isLiveData={isLiveData} />
              ) : (
                <StationTimeline stations={data.stations} />
              )}
            </div>
          ) : statusPending ? (
            <StatusSkeleton />
          ) : isLoading ? (
            <StatusSkeleton />
          ) : isError ? (
            <div
              className="animate-fade-up bg-destructive/10 border border-destructive/30 rounded-xl p-5 flex flex-col items-center text-center space-y-4"
              data-testid="status-error"
            >
              <AlertTriangle className="w-10 h-10 text-destructive mb-2" />
              <h2 className="font-mono text-lg text-destructive font-bold uppercase tracking-widest">
                {t("error.signalLost")}
              </h2>
              <p className="font-mono text-muted-foreground text-sm max-w-md">
                {t(errorKey)}
              </p>
              <Button
                onClick={handleRefresh}
                className="font-mono uppercase tracking-widest mt-2"
                data-testid="status-retry"
              >
                {t("action.retry")}
              </Button>
            </div>
          ) : isFetching ? (
            <StatusSkeleton />
          ) : null}
        </div>
      </main>
    </div>
  );
}
