import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTrainStatusQueryKey } from "@workspace/api-client-react";
import type {
  StationStatus,
  TrainStatusResponse,
} from "@workspace/api-client-react";
import {
  formatShortDate,
  fromApiDate,
  getDateWindow,
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
import { useTrainRuns } from "@/hooks/use-train-runs";
import { useTrainCatalog } from "@/hooks/use-train-catalog";
import { useTrainSearch } from "@/hooks/use-train-search";
import { DateTabs } from "@/components/status/date-tabs";
import { DelayBadge } from "@/components/status/delay-badge";
import { JourneySummary } from "@/components/status/journey-summary";
import { ProgressBar } from "@/components/status/progress-bar";
import { StationTimeline } from "@/components/status/station-timeline";
import { StatusMessage } from "@/components/status/status-message";
import { StatusSkeleton } from "@/components/status/status-skeleton";
import { TrackView } from "@/components/status/track-view";
import { ViewToggle } from "@/components/status/view-toggle";
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
          className="text-muted-foreground border-muted-foreground bg-background font-mono text-sm tracking-widest"
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
  const queryClient = useQueryClient();
  const [view, setView] = useViewPreference();

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

  const { runs } = useTrainRuns(searched ? apiParams.train_number : null);

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

  const dates = useMemo(() => {
    const runDates =
      runs && runs.length > 0 ? runs.map(fromApiDate) : null;
    const windowDates = runDates ?? getDateWindow(3, 3);
    const todayApi = toApiDate(getUpcomingDates(1)[0]);
    const tomorrowApi = toApiDate(getUpcomingDates(2)[1]);
    const yesterdayApi = toApiDate(getDateWindow(1, 0)[0]);
    return windowDates.map((iso) => {
      const apiDate = toApiDate(iso);
      return {
        iso,
        apiDate,
        label:
          apiDate === todayApi
            ? t("label.today")
            : apiDate === tomorrowApi
              ? t("label.tomorrow")
              : apiDate === yesterdayApi
                ? t("label.yesterday")
                : formatShortDate(iso),
      };
    });
  }, [t, runs]);

  const { data, isLoading, isFetching, isError, isPlaceholderData, messageKey } =
    useTrainStatus(searched ? apiParams : null);

  /** A status payload is only "live" while it is current AND freshly updated. */
  const isLiveData =
    !!data &&
    !isPlaceholderData &&
    !!data.last_updated &&
    Date.now() - Date.parse(data.last_updated) <= LIVE_DATA_TTL_MS;

  const handleRetry = () => {
    queryClient.invalidateQueries({
      queryKey: getGetTrainStatusQueryKey(apiParams),
    });
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
        <div className="h-1 bg-brand" />
        <header className="bg-card border-b border-border">
          <div className="max-w-2xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <TrainFront className="w-5 h-5 text-primary" />
              </span>
              <span className="font-mono font-extrabold text-lg md:text-xl text-foreground uppercase tracking-tight">
                {t("app.title")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <DisplaySettings />
              <LanguageSwitcher />
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-2xl mx-auto px-4 md:px-6 py-8 md:py-12">
          <div className="animate-fade-up relative z-10">
            <div className="bg-[radial-gradient(900px_400px_at_50%_-20%,hsl(var(--brand)/0.06),transparent)] rounded-2xl">
              <div className="bg-card border border-card-border rounded-2xl shadow-sm">
                <div className="p-5 sm:p-6 md:p-8 space-y-5">
                  <div>
                    <h1
                      className="font-mono text-2xl md:text-3xl font-bold uppercase tracking-widest text-foreground"
                      data-testid="search-title"
                    >
                      {t("label.searchTitle")}
                    </h1>
                    <p className="mt-1.5 font-mono text-xs md:text-sm text-muted-foreground uppercase tracking-widest">
                      {t("app.tagline")}
                    </p>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-card-border bg-background/50">
                    <TrainIllustration className="h-12 w-full" />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="trainNo"
                      className="text-sm font-medium text-foreground block"
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
                </div>
              </div>
            </div>
          </div>

          {recent.length > 0 && (
            <section
              className="mt-6 animate-fade-up"
              data-testid="recent-searches"
            >
              <h2 className="font-mono text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" /> {t("label.recent")}
              </h2>
              <RecentChips recent={recent} onSelect={handleSelectRecent} />
            </section>
          )}
        </main>
      </div>
    );
  }

  // PAGE 2 — Results
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <div className="h-1 bg-brand" />
      <header className="bg-card border-b border-border sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-3 md:px-6 h-12 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={reset}
            className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-transparent"
            aria-label={t("action.abortReturn")}
            data-testid="button-new-search"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="min-w-0 flex-1 flex items-center gap-2">
            {data ? (
              <>
                <span
                  className="font-mono text-lg font-bold text-primary truncate"
                  data-testid="header-train-number"
                >
                  {data.train_number}
                </span>
                <span className="hidden sm:inline text-xs font-mono text-muted-foreground uppercase tracking-widest truncate">
                  {data.train_name}
                </span>
              </>
            ) : (
              <div
                className="flex items-center gap-2 min-w-0"
                data-testid="header-train-skeleton"
              >
                <div className="h-6 w-14 shrink-0 rounded bg-border/50 animate-pulse" />
                <div className="hidden sm:block h-4 w-40 rounded bg-border/40 animate-pulse" />
              </div>
            )}
            {data && (
              <DelayBadge delayMinutes={data.current_delay_minutes ?? null} />
            )}
          </div>

          <div className="hidden md:block w-48 lg:w-56 shrink-0">
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

          <DisplaySettings className="shrink-0" />
          <LanguageSwitcher iconOnly className="shrink-0" />
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 md:p-6">
        {data && (
          <div
            className="mb-6 space-y-3 animate-fade-up"
            data-testid="train-identity-hero"
          >
            <TrainIdentityBlock data={data} stations={stations} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div data-testid="status-delay-badge">
                <DelayBadge delayMinutes={data.current_delay_minutes ?? null} />
              </div>
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
          </div>
        )}

        <div className="mb-6">
          <DateTabs
            dates={dates}
            active={apiParams.departure_date}
            onChange={selectDate}
          />
        </div>

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
        ) : isLoading ? (
          <StatusSkeleton />
        ) : isError ? (
          <div
            className="animate-fade-up bg-destructive/10 border border-destructive rounded-xl p-5 flex flex-col items-center text-center space-y-4"
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
              onClick={handleRetry}
              className="font-mono uppercase tracking-widest mt-2"
              data-testid="status-retry"
            >
              {t("action.retry")}
            </Button>
          </div>
        ) : isFetching ? (
          <StatusSkeleton />
        ) : null}
      </main>
    </div>
  );
}
