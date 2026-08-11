import { Activity, ArrowLeft, TrainFront } from "lucide-react";
import { Link } from "wouter";
import { InvertToggle } from "../components/invert-toggle";
import { RecentChips } from "../components/recent-chips";
import { JourneyView } from "@/features/journey/journey-view";
import { SearchBox } from "@/features/search/search-box";
import { useRecentSearches } from "../hooks/use-recent-searches";
import { useTrainCatalog } from "../hooks/use-train-catalog";
import { useTrainSearch } from "../hooks/use-train-search";

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
    handleSubmit,
    handleSelectRecent,
    reset,
  } = useTrainSearch({ trains, addRecent });

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
              <h1 className="text-3xl font-bold" data-testid="search-title">
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
              {apiParams.train_number}
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
        <div className="mx-auto max-w-3xl px-4 py-6">
          <JourneyView trainNumber={apiParams.train_number} />
        </div>
      </main>
    </div>
  );
}
