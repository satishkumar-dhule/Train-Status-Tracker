import { useEffect, useMemo } from "react";
import { Activity, ArrowLeft, TrainFront } from "lucide-react";
import { Link } from "wouter";
import {
  formatShortDate,
  fromApiDate,
  getUpcomingDates,
  pickDefaultRunDate,
  toApiDate,
} from "@workspace/trains-data";
import { InvertToggle } from "../components/invert-toggle";
import { RecentChips } from "../components/recent-chips";
import { RunSelector, type RunTab } from "../components/run-selector";
import { SearchBox } from "../components/search-box";
import { StatusView } from "../components/status-view";
import { useRecentSearches } from "../hooks/use-recent-searches";
import { useTrainCatalog } from "../hooks/use-train-catalog";
import { useTrainRuns } from "../hooks/use-train-runs";
import { useTrainSearch } from "../hooks/use-train-search";
import { useTrainStatus } from "../hooks/use-train-status";

export default function Home() {
  const { recent, addRecent } = useRecentSearches();
  const { trains } = useTrainCatalog();
  const {
    value,
    setValue,
    validity,
    setValidity,
    selected,
    setSelected,
    searched,
    apiParams,
    setDepartureDate,
    userPickedDate,
    selectDate,
    handleSubmit,
    handleSelectRecent,
    reset,
  } = useTrainSearch({ trains, addRecent });

  const { runs, isError: runsError } = useTrainRuns(
    searched ? apiParams.train_number : null,
  );

  // Once the train's runs are known, land on a run date: today when the train
  // runs today, otherwise the most recent past run (or the next run). Never
  // overrides a date the user picked manually.
  useEffect(() => {
    if (!searched || userPickedDate) return;
    const recommended =
      runs && runs.length > 0 ? pickDefaultRunDate(runs) : null;
    if (recommended && recommended !== apiParams.departure_date) {
      setDepartureDate(recommended);
    }
  }, [searched, userPickedDate, runs, apiParams.departure_date, setDepartureDate]);

  // Run tabs come exclusively from the train's run dates: the previous 2 runs
  // before today, the current run (today when it runs today), and the next
  // run. A day the train does not run on can never appear here.
  const dates = useMemo<RunTab[]>(() => {
    if (!runs || runs.length === 0) return [];
    const todayApi = toApiDate(getUpcomingDates(1)[0]);
    const past = runs.filter((r) => r <= todayApi);
    const future = runs.filter((r) => r > todayApi);
    const windowApi = [
      ...past.slice(Math.max(0, past.length - 3)),
      ...future.slice(0, 1),
    ];
    const currentRunApi = past.length ? past[past.length - 1] : null;
    const nextRunApi = future[0] ?? null;

    return windowApi.map((apiDate) => {
      const isCurrent = apiDate === currentRunApi;
      const isNext = apiDate === nextRunApi;
      const iso = fromApiDate(apiDate);
      return {
        apiDate,
        iso,
        label: isCurrent
          ? "Today"
          : isNext
            ? "Next"
            : formatShortDate(iso),
        sub: isCurrent || isNext ? formatShortDate(iso) : undefined,
      };
    });
  }, [runs]);

  // The running-status query must never target a day the train does not run
  // on. While run dates are still loading it is held; when discovery failed
  // or returned no schedule we fail open on the selected date.
  const runsKnown = runs !== undefined;
  const statusEnabled =
    searched &&
    (runsError ||
      (runsKnown &&
        (runs.length === 0 ||
          runs.includes(apiParams.departure_date))));

  const status = useTrainStatus(
    searched ? apiParams : null,
    statusEnabled,
  );
  const data = status.data;

  if (!searched) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-foreground/15">
                <TrainFront className="h-5 w-5" />
              </span>
              <span className="truncate text-lg font-semibold">
                Rail Saarthi
              </span>
            </div>
            <Link
              href="/monitoring"
              data-testid="nav-link-monitoring"
              aria-label="API monitor"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-current transition-colors hover:bg-current/15"
            >
              <Activity className="h-5 w-5" />
            </Link>
            <InvertToggle />
          </div>
        </header>

        <main className="w-full flex-1">
          <div className="mx-auto max-w-3xl px-4 pb-6 pt-10">
            <div className="text-center">
              <h1
                className="text-3xl font-bold"
                data-testid="search-title"
              >
                Track Your Train
              </h1>
              <p className="mt-2 text-muted-foreground">
                Live status for any Indian Railways train.
              </p>
            </div>

            <div className="mx-auto mt-6 max-w-xl rounded-xl border border-card-border bg-card p-4">
              <label
                htmlFor="trainNo"
                className="mb-2 block text-sm font-medium"
              >
                Train Number
              </label>
              <SearchBox
                value={value}
                onValueChange={setValue}
                onValidityChange={setValidity}
                onSelectedChange={setSelected}
                onSubmit={handleSubmit}
                autoFocus
              />
            </div>

            {recent.length > 0 && (
              <section
                className="mx-auto mt-8 max-w-xl"
                data-testid="recent-searches"
              >
                <h2 className="mb-3 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Recent
                </h2>
                <RecentChips recent={recent} onSelect={handleSelectRecent} />
              </section>
            )}
          </div>
        </main>

        <footer className="py-6 text-center text-sm text-muted-foreground">
          Indian Railways · Rail Saarthi
        </footer>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-3">
          <button
            type="button"
            onClick={reset}
            aria-label="Back to search"
            data-testid="button-new-search"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-primary-foreground/15"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <span
              className="block truncate font-mono text-base font-semibold"
              data-testid="header-train-number"
            >
              {data?.train_number ?? apiParams.train_number}
            </span>
            {data && (
              <span className="hidden text-xs text-primary-foreground/80 sm:block">
                {data.source_station_code} → {data.destination_station_code}
              </span>
            )}
          </div>
          <Link
            href="/monitoring"
            data-testid="nav-link-monitoring"
            aria-label="API monitor"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-current transition-colors hover:bg-current/15"
          >
            <Activity className="h-5 w-5" />
          </Link>
          <InvertToggle />
        </div>
      </header>

      <main className="w-full flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {dates.length > 0 && (
            <div className="mb-4">
              <RunSelector
                dates={dates}
                active={apiParams.departure_date}
                onChange={selectDate}
              />
            </div>
          )}
          <StatusView result={status} />
        </div>
      </main>
    </div>
  );
}
