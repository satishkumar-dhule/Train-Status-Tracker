import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { InvertToggle } from "../components/invert-toggle";
import { MonitoringView } from "@/features/monitoring/monitoring-view";
import { useApiMonitoring } from "../hooks/use-api-monitoring";

export default function Monitoring() {
  const result = useApiMonitoring();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-3">
          <Link
            href="/"
            data-testid="monitoring-back"
            aria-label="Back to home"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-current transition-colors hover:bg-primary-foreground/15"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <span className="block truncate font-mono text-base font-semibold">
              API Monitor
            </span>
            <span className="hidden text-xs text-primary-foreground/80 sm:block">
              Live endpoint telemetry
            </span>
          </div>
          <InvertToggle />
        </div>
      </header>

      <main className="w-full flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <MonitoringView result={result} />
        </div>
      </main>

      <footer className="py-6 text-center text-sm text-muted-foreground">
        Indian Railways · Rail Saarthi
      </footer>
    </div>
  );
}
