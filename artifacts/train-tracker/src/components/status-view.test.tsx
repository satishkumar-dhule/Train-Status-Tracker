import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StationStatus, TrainStatusResponse } from "@workspace/api-client-react";
import type { TrainStatusResult } from "../hooks/use-train-status";
import { StatusView } from "./status-view";

const STATIONS: StationStatus[] = [
  {
    station_code: "INDB",
    station_name: "Indore Jn",
    scheduled_departure: "06:00",
    scheduled_arrival: null,
    actual_departure: "06:05",
    actual_arrival: null,
    distance_from_source: 0,
    is_current: false,
    day: 1,
    delay_minutes: 5,
    platform: "1",
    halt_minutes: 0,
    has_departed: true,
  },
  {
    station_code: "UJN",
    station_name: "Ujjain Jn",
    scheduled_arrival: "07:20",
    scheduled_departure: "07:25",
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: 55,
    is_current: true,
    day: 1,
    delay_minutes: null,
    platform: "2",
    halt_minutes: 5,
    has_departed: false,
  },
  {
    station_code: "BPL",
    station_name: "Bhopal Jn",
    scheduled_arrival: "10:30",
    scheduled_departure: null,
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: 304,
    is_current: false,
    day: 2,
    delay_minutes: null,
    platform: null,
    halt_minutes: null,
    has_departed: false,
  },
];

const RESPONSE: TrainStatusResponse = {
  train_number: "22943",
  train_name: "Indore Intercity SF Express",
  departure_date: "20260801",
  source_station_code: "INDB",
  source_station_name: "Indore Jn",
  destination_station_code: "BPL",
  destination_station_name: "Bhopal Jn",
  current_station_code: "UJN",
  current_station_name: "Ujjain Jn",
  current_delay_minutes: 10,
  status_message: "Running late by 10 minutes",
  last_updated: "2026-08-01T12:00:00Z",
  stations: STATIONS,
};

function makeResult(
  overrides: Partial<TrainStatusResult> = {},
): TrainStatusResult {
  return {
    data: RESPONSE,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    errorType: null,
    refetch: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("StatusView", () => {
  it("shows a skeleton while there is no data", () => {
    render(<StatusView result={makeResult({ data: undefined, isLoading: true })} />);

    expect(screen.getByTestId("status-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("text-train-number")).not.toBeInTheDocument();
  });

  it("shows an error panel with the failure reason and retry", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn(async () => undefined);
    render(
      <StatusView
        result={makeResult({
          data: undefined,
          isError: true,
          errorType: "provider",
          refetch,
        })}
      />,
    );

    expect(screen.getByTestId("status-error")).toHaveTextContent(
      "The train data provider is unreachable. Please try again.",
    );

    await user.click(screen.getByTestId("status-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the identity, route, and delay badge", () => {
    render(<StatusView result={makeResult()} />);

    expect(screen.getByTestId("text-train-number")).toHaveTextContent("22943");
    expect(screen.getByTestId("text-train-name")).toHaveTextContent(
      "Indore Intercity SF Express",
    );
    expect(screen.getByTestId("status-delay-badge")).toHaveTextContent("+10 min");
    expect(screen.getByTestId("status-delay-badge")).toHaveAttribute(
      "data-variant",
      "late",
    );
    expect(screen.getByTestId("status-delay-badge")).toHaveClass(
      "bg-warning",
      "text-warning-foreground",
    );
    expect(screen.getByTestId("train-identity-hero")).toHaveTextContent("Indore Jn");
    expect(screen.getByTestId("train-identity-hero")).toHaveTextContent("Bhopal Jn");
  });

  it("renders an on-time badge in the success color when the train is on time", () => {
    render(
      <StatusView
        result={makeResult({
          data: { ...RESPONSE, current_delay_minutes: 0 },
        })}
      />,
    );

    expect(screen.getByTestId("status-delay-badge")).toHaveTextContent(
      "On time",
    );
    expect(screen.getByTestId("status-delay-badge")).toHaveAttribute(
      "data-variant",
      "on-time",
    );
    expect(screen.getByTestId("status-delay-badge")).toHaveClass(
      "bg-success",
      "text-success-foreground",
    );
  });

  it("omits the delay badge when the delay is unknown", () => {
    render(
      <StatusView
        result={makeResult({
          data: { ...RESPONSE, current_delay_minutes: null },
        })}
      />,
    );

    expect(screen.queryByTestId("status-delay-badge")).not.toBeInTheDocument();
  });

  it("renders the summary, next stop, progress, and station timeline", () => {
    render(<StatusView result={makeResult()} />);

    expect(screen.getByTestId("journey-summary")).toBeInTheDocument();
    expect(screen.getByTestId("next-stop-card")).toBeInTheDocument();
    expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
    expect(screen.getByTestId("station-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-INDB")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-UJN")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-BPL")).toBeInTheDocument();
  });

  it("shows the provider status message when present", () => {
    render(<StatusView result={makeResult()} />);

    expect(screen.getByTestId("status-message")).toHaveTextContent(
      "Running late by 10 minutes",
    );
  });

  it("shows the updated time and a refresh button that refetches", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn(async () => undefined);
    render(<StatusView result={makeResult({ refetch })} />);

    expect(screen.getByTestId("status-updated")).toHaveTextContent("Updated:");

    await user.click(screen.getByTestId("button-refresh"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows a refreshing hint instead of the updated time for placeholder data", () => {
    render(<StatusView result={makeResult({ isPlaceholderData: true })} />);

    expect(screen.getByTestId("status-refreshing")).toHaveTextContent(
      "Refreshing…",
    );
    expect(screen.queryByTestId("status-updated")).not.toBeInTheDocument();
  });

  it("shows delay/on-time per station in the timeline", () => {
    render(<StatusView result={makeResult()} />);

    expect(screen.getByTestId("row-station-INDB")).toHaveTextContent("+5 min");
    expect(screen.getByTestId("row-station-BPL")).toHaveTextContent("Day 2");
    expect(screen.getByTestId("row-station-UJN")).toHaveTextContent("PF 2");
  });
});
