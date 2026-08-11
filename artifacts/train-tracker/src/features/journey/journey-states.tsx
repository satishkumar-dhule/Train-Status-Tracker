import { CalendarClock } from "lucide-react";
import { Button, Card, Pill, Skeleton } from "@/components/primitives";
import { cn } from "@/lib/utils";

export type JourneyErrorType = "not-found" | "provider" | "network";

export interface JourneyErrorProps {
  errorType: JourneyErrorType | null;
  trainNumber: string;
  departureDate: string;
  onRetry: () => void;
}

export interface JourneyEmptyProps {
  trainNumber: string;
  departureDate: string;
  onSelectDate: (apiDate: string) => void;
}

const ERROR_HEADINGS: Record<JourneyErrorType, string> = {
  "not-found": "Train not found",
  provider: "Schedule source unavailable",
  network: "Service unreachable",
};

function buildErrorMessage(
  errorType: JourneyErrorType | null,
  trainNumber: string,
  departureDate: string,
): string {
  switch (errorType) {
    case "not-found":
      return `We couldn't find ${trainNumber} on ${departureDate}. Double-check the number or try another run date.`;
    case "provider":
      return `The schedule source for ${trainNumber} is unavailable right now. Try again in a moment.`;
    case "network":
      return "We couldn't reach the schedule service. Check your connection and retry.";
    default:
      return "We couldn't load the schedule right now. Try again in a moment.";
  }
}

export function JourneySkeleton({ className }: { className?: string }) {
  return (
    <Card
      data-testid="status-skeleton"
      className={cn("space-y-5", className)}
    >
      <div className="space-y-2">
        <Skeleton lines={1} className="w-2/5" />
        <Skeleton lines={1} className="w-3/5" />
      </div>
      <Skeleton lines={2} />
      <Skeleton lines={3} className="w-5/6" />
    </Card>
  );
}

export function JourneyError({
  errorType,
  trainNumber,
  departureDate,
  onRetry,
}: JourneyErrorProps) {
  return (
    <Card
      data-testid="status-error"
      className="flex flex-col items-center gap-4 p-6 text-center"
    >
      <Pill variant="cancelled">Error</Pill>
      <h2 className="font-mono text-lg font-bold uppercase tracking-widest">
        {errorType ? ERROR_HEADINGS[errorType] : "Schedule unavailable"}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {buildErrorMessage(errorType, trainNumber, departureDate)}
      </p>
      <Button variant="primary" data-testid="status-retry" onClick={onRetry}>
        Retry
      </Button>
    </Card>
  );
}

export function JourneyEmpty({
  trainNumber,
  departureDate,
  onSelectDate,
}: JourneyEmptyProps) {
  return (
    <Card
      data-testid="status-empty"
      className="flex flex-col items-center gap-4 p-6 text-center"
    >
      <CalendarClock
        className="h-10 w-10 text-muted-foreground"
        aria-hidden
      />
      <h2 className="font-mono text-lg font-bold uppercase tracking-widest">
        No scheduled departure
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        No departure scheduled for {trainNumber} on {departureDate}.
      </p>
      <Button variant="primary" onClick={() => onSelectDate(departureDate)}>
        Pick another run date
      </Button>
    </Card>
  );
}
