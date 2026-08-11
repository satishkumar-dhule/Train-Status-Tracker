import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StationStatus, TrainStatusResponse } from "@workspace/api-client-react";
import { GATEWAY_AUTO } from "@/components/gateway-selector";
import type { JourneySlice } from "./journey-slice";
import { JourneyView } from "./journey-view";

const mocks = vi.hoisted(() => ({
  useJourney: vi.fn(),
}));

vi.mock("./journey-slice", () => ({
  useJourney: mocks.useJourney,
}));

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
  provider: "paytm",
  stations: STATIONS,
};

const DATES: JourneySlice["dates"] = [
  {
    apiDate: "20260801",
    iso: "2026-08-01",
    label: "Today",
    isDefault: true,
    isSelected: true,
  },
  {
    apiDate: "20260810",
    iso: "2026-08-10",
    label: "Next",
    isSelected: false,
  },
];

function makeStatus(
  overrides: Partial<JourneySlice["status"]> = {},
): JourneySlice["status"] {
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

function makeSlice(overrides: Partial<JourneySlice> = {}): JourneySlice {
  return {
    selected: { trainNumber: "22943", departureDate: "20260801" },
    runs: ["20260801", "20260810"],
    runsError: false,
    dates: DATES,
    activeDate: "20260801",
    selectDate: vi.fn(),
    userPickedDate: false,
    gateway: GATEWAY_AUTO,
    setGateway: vi.fn(),
    gateways: ["paytm", "goibibo"],
    status: makeStatus(),
    refresh: vi.fn(),
    autoRefresh: {
      enabled: false,
      cadenceMs: 5 * 60_000,
      setEnabled: vi.fn(),
      setCadence: vi.fn(),
    },
    ...overrides,
  };
}

function mockJourney(overrides: Partial<JourneySlice> = {}) {
  mocks.useJourney.mockReturnValue(makeSlice(overrides));
}

function longStations(count: number, currentIndex: number): StationStatus[] {
  return Array.from({ length: count }, (_, i) => ({
    station_code: `ST${String(i).padStart(2, "0")}`,
    station_name: `Station ${i}`,
    scheduled_departure: i === count - 1 ? null : "08:00",
    scheduled_arrival: i === 0 ? null : "09:00",
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: i * 10,
    is_current: i === currentIndex,
    day: 1,
    delay_minutes: null,
    platform: null,
    halt_minutes: null,
    has_departed: i < currentIndex,
  }));
}

beforeEach(() => {
  mocks.useJourney.mockReset();
});

describe("JourneyView", () => {
  it("renders nothing when no train is selected", () => {
    mockJourney({ selected: null });
    const { container } = render(<JourneyView trainNumber={null} />);

    expect(mocks.useJourney).toHaveBeenCalledWith(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the skeleton while status is loading", () => {
    mockJourney({
      status: makeStatus({ data: undefined, isLoading: true, isFetching: true }),
    });

    render(<JourneyView trainNumber="22943" />);

    expect(screen.getByTestId("status-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("train-identity-hero")).not.toBeInTheDocument();
  });

  it("shows the error panel and retry calls refresh", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    mockJourney({
      status: makeStatus({
        data: undefined,
        isError: true,
        errorType: "provider",
      }),
      refresh,
    });

    render(<JourneyView trainNumber="22943" />);

    expect(screen.getByTestId("status-error")).toBeInTheDocument();
    expect(screen.getByTestId("status-error")).toHaveTextContent(
      "Schedule source unavailable",
    );

    await user.click(screen.getByTestId("status-retry"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders the hero with the delay answer before the next-stop card", () => {
    mockJourney();

    render(<JourneyView trainNumber="22943" />);

    const hero = screen.getByTestId("train-identity-hero");
    const nextStop = screen.getByTestId("next-stop-card");
    expect(
      hero.compareDocumentPosition(nextStop) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    expect(within(hero).getByText("10 min late")).toBeInTheDocument();
    expect(screen.getByTestId("text-train-number")).toHaveTextContent("22943");
    expect(screen.getByTestId("text-train-name")).toHaveTextContent(
      "Indore Intercity SF Express",
    );
    expect(hero).toHaveTextContent("Indore Jn");
    expect(hero).toHaveTextContent("Bhopal Jn");
    expect(screen.getByTestId("status-message")).toHaveTextContent(
      "Running late by 10 minutes",
    );
  });

  it("shows On time in the hero when the train is on time", () => {
    mockJourney({
      status: makeStatus({
        data: { ...RESPONSE, current_delay_minutes: 0 },
      }),
    });

    render(<JourneyView trainNumber="22943" />);

    expect(
      within(screen.getByTestId("train-identity-hero")).getByText("On time"),
    ).toBeInTheDocument();
  });

  it("renders the summary, next stop, route strip, and station timeline", () => {
    mockJourney();

    render(<JourneyView trainNumber="22943" />);

    const nextStop = screen.getByTestId("next-stop-card");
    expect(nextStop).toHaveTextContent("BPL");
    expect(nextStop).toHaveTextContent("Bhopal Jn");
    expect(nextStop).toHaveTextContent("10:30");
    expect(nextStop).toHaveTextContent("249 KM ahead");
    expect(nextStop).toHaveTextContent("Day 2");

    const summary = screen.getByTestId("journey-summary");
    expect(summary).toHaveTextContent("Indore Jn → Bhopal Jn");
    expect(summary).toHaveTextContent("4h 30m");
    expect(summary).toHaveTextContent("3");

    expect(screen.getByTestId("journey-route")).toBeInTheDocument();
    expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
    expect(screen.getByTestId("route-segment-UJN")).toBeInTheDocument();
    expect(screen.getByTestId("route-segment-BPL")).toBeInTheDocument();
    expect(screen.getByTestId("station-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-INDB")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-UJN")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-BPL")).toBeInTheDocument();
  });

  it("renders the run selector tabs and fires selectDate", async () => {
    const user = userEvent.setup();
    const selectDate = vi.fn();
    mockJourney({ selectDate });

    render(<JourneyView trainNumber="22943" />);

    expect(screen.getByTestId("run-selector")).toBeInTheDocument();
    expect(screen.getByTestId("tab-date-20260801")).toHaveTextContent("Today");
    expect(screen.getByTestId("tab-date-20260810")).toHaveTextContent("Next");

    await user.click(screen.getByTestId("tab-date-20260810"));
    expect(selectDate).toHaveBeenCalledWith("20260810");
  });

  it("shows a window of stations and expands the timeline via the toggle", async () => {
    const user = userEvent.setup();
    mockJourney({
      status: makeStatus({
        data: { ...RESPONSE, stations: longStations(9, 3) },
      }),
    });

    render(<JourneyView trainNumber="22943" />);

    const rows = () => screen.getAllByTestId(/^row-station-/);
    expect(rows()).toHaveLength(5);

    const toggle = screen.getByTestId("all-stations-toggle");
    await user.click(toggle);

    expect(rows()).toHaveLength(9);
  });

  it("shows the formatted update time in the source notes", () => {
    mockJourney();

    render(<JourneyView trainNumber="22943" />);

    const notes = screen.getByTestId("source-notes");
    expect(within(notes).getByTestId("status-updated")).toHaveTextContent(
      /^Updated (just now|\d+[smh] ago)$/,
    );
    expect(
      within(notes).queryByTestId("status-provider"),
    ).not.toBeInTheDocument();
  });

  it("shows the provider label and stale/refreshing hints when applicable", () => {
    mockJourney({
      gateway: "paytm",
      status: makeStatus({
        isFetching: true,
        isPlaceholderData: true,
      }),
    });

    render(<JourneyView trainNumber="22943" />);

    const notes = screen.getByTestId("source-notes");
    expect(within(notes).getByTestId("status-provider")).toHaveTextContent(
      "via Paytm",
    );
    expect(within(notes).getByTestId("status-refreshing")).toHaveTextContent(
      "Refreshing…",
    );
    expect(within(notes).getByText("Stale")).toBeInTheDocument();
  });

  it("reveals the gateway selector from the data source disclosure", async () => {
    const user = userEvent.setup();
    const setGateway = vi.fn();
    mockJourney({ gateway: "paytm", setGateway });

    render(<JourneyView trainNumber="22943" />);

    expect(screen.queryByTestId("select-gateway")).not.toBeInTheDocument();

    const toggle = screen.getByTestId("gateway-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByTestId("gateway-selector")).toBeInTheDocument();
    const select = screen.getByTestId("select-gateway");
    expect(select).toHaveValue("paytm");

    await user.selectOptions(select, "goibibo");
    expect(setGateway).toHaveBeenCalledWith("goibibo");
  });

  it("wires the live toggle to autoRefresh.setEnabled", async () => {
    const user = userEvent.setup();
    const setEnabled = vi.fn();
    mockJourney({
      autoRefresh: {
        enabled: true,
        cadenceMs: 5 * 60_000,
        setEnabled,
        setCadence: vi.fn(),
      },
    });

    render(<JourneyView trainNumber="22943" />);

    const toggle = screen.getByTestId("live-status-toggle");
    expect(toggle).toHaveTextContent("Live on");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it("fires refresh from the refresh button", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    mockJourney({ refresh });

    render(<JourneyView trainNumber="22943" />);

    await user.click(screen.getByTestId("button-refresh"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there is no data and is not loading or erroring", async () => {
    const user = userEvent.setup();
    const selectDate = vi.fn();
    mockJourney({
      status: makeStatus({ data: undefined }),
      selectDate,
    });

    render(<JourneyView trainNumber="22943" />);

    const empty = screen.getByTestId("status-empty");
    expect(empty).toHaveTextContent(
      "No departure scheduled for 22943 on 20260801.",
    );

    await user.click(
      within(empty).getByRole("button", { name: "Pick another run date" }),
    );
    expect(selectDate).toHaveBeenCalledWith("20260801");
  });
});
