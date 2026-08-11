import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  JourneyEmpty,
  JourneyError,
  JourneySkeleton,
} from "./journey-states";

const TRAIN_NUMBER = "22943";
const DEPARTURE_DATE = "20260807";

describe("JourneySkeleton", () => {
  it("renders a status-skeleton container with at least one Skeleton element", () => {
    const { container } = render(<JourneySkeleton />);

    expect(screen.getByTestId("status-skeleton")).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThanOrEqual(1);
  });

  it("forwards an optional className to the wrapper", () => {
    render(<JourneySkeleton className="mt-4" />);

    expect(screen.getByTestId("status-skeleton")).toHaveClass("mt-4");
  });
});

describe("JourneyError", () => {
  it("renders the not-found copy with the train number and departure date", () => {
    render(
      <JourneyError
        errorType="not-found"
        trainNumber={TRAIN_NUMBER}
        departureDate={DEPARTURE_DATE}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByTestId("status-error")).toBeInTheDocument();
    expect(screen.getByText("Train not found")).toBeInTheDocument();
    expect(screen.getByText(/We couldn't find 22943 on 20260807/)).toBeInTheDocument();
    expect(screen.getByText(/Double-check the number or try another run date/)).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders the provider copy with the train number", () => {
    render(
      <JourneyError
        errorType="provider"
        trainNumber={TRAIN_NUMBER}
        departureDate={DEPARTURE_DATE}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("Schedule source unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/The schedule source for 22943 is unavailable right now/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Try again in a moment/)).toBeInTheDocument();
  });

  it("renders the network copy", () => {
    render(
      <JourneyError
        errorType="network"
        trainNumber={TRAIN_NUMBER}
        departureDate={DEPARTURE_DATE}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("Service unreachable")).toBeInTheDocument();
    expect(
      screen.getByText(/We couldn't reach the schedule service/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Check your connection and retry/)).toBeInTheDocument();
  });

  it("renders a fallback copy when errorType is null", () => {
    render(
      <JourneyError
        errorType={null}
        trainNumber={TRAIN_NUMBER}
        departureDate={DEPARTURE_DATE}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("Schedule unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/We couldn't load the schedule right now/),
    ).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is pressed", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <JourneyError
        errorType="network"
        trainNumber={TRAIN_NUMBER}
        departureDate={DEPARTURE_DATE}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByTestId("status-retry"));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("JourneyEmpty", () => {
  it("renders the not-scheduled copy with the train number and departure date", () => {
    render(
      <JourneyEmpty
        trainNumber={TRAIN_NUMBER}
        departureDate={DEPARTURE_DATE}
        onSelectDate={() => {}}
      />,
    );

    expect(screen.getByTestId("status-empty")).toBeInTheDocument();
    expect(screen.getByText("No scheduled departure")).toBeInTheDocument();
    expect(
      screen.getByText(/No departure scheduled for 22943 on 20260807/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pick another run date/i })).toBeInTheDocument();
  });

  it("calls onSelectDate with the departure date when the button is pressed", async () => {
    const user = userEvent.setup();
    const onSelectDate = vi.fn();
    render(
      <JourneyEmpty
        trainNumber={TRAIN_NUMBER}
        departureDate={DEPARTURE_DATE}
        onSelectDate={onSelectDate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pick another run date/i }));

    expect(onSelectDate).toHaveBeenCalledWith(DEPARTURE_DATE);
  });
});
