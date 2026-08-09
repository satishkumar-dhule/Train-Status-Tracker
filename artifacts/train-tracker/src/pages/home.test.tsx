import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecentSearchesProvider } from "@/context/recent-searches";
import { RECENT_SEARCHES_STORAGE_KEY } from "@/lib/recent-searches";
import { getUpcomingDates, toApiDate } from "@workspace/trains-data";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { TrainStatusResponse } from "@workspace/api-client-react";
import Home from "./Home";

const mocks = vi.hoisted(() => ({
  useTrainStatus: vi.fn(),
  useTrainRuns: vi.fn(),
  refetch: vi.fn(async () => undefined),
  calls: [] as Array<{ train_number: string; departure_date: string } | null>,
}));

vi.mock("@/hooks/use-train-status", () => ({
  useTrainStatus: mocks.useTrainStatus,
}));

vi.mock("@/hooks/use-train-runs", () => ({
  useTrainRuns: mocks.useTrainRuns,
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    getTrainCatalog: vi.fn(async () => ({
      trains: [
        { number: "22943", name: "Indore Intercity SF Express" },
        { number: "12951", name: "Mumbai Rajdhani Express" },
      ],
    })),
  };
});

function makeResponse(
  overrides: Partial<TrainStatusResponse> = {},
): TrainStatusResponse {
  return {
    train_number: "22943",
    train_name: "Indore Intercity SF Express",
    departure_date: "20260805",
    source_station_code: "INDB",
    source_station_name: "Indore Jn",
    destination_station_code: "BPL",
    destination_station_name: "Bhopal Jn",
    current_station_code: "UJN",
    current_station_name: "Ujjain Jn",
    current_delay_minutes: 10,
    status_message: "Running late by 10 minutes",
    last_updated: "2026-08-05T12:00:00Z",
    stations: [
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
    ],
    ...overrides,
  };
}

function heldResult() {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    errorType: null,
    refetch: mocks.refetch,
  };
}

function mockSuccess() {
  mocks.useTrainStatus.mockImplementation(
    (params: { train_number: string; departure_date: string } | null, enabled?: boolean) => {
      if (!params || enabled === false) {
        mocks.calls.push(null);
        return heldResult();
      }
      mocks.calls.push(params);
      return {
        data: makeResponse({
          train_number: params.train_number,
          departure_date: params.departure_date,
        }),
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        isError: false,
        errorType: null,
        refetch: mocks.refetch,
      };
    },
  );
}

function mockError(type: "not-found" | "provider" | "network") {
  mocks.useTrainStatus.mockImplementation(
    (params: { train_number: string; departure_date: string } | null, enabled?: boolean) => {
      if (!params || enabled === false) {
        mocks.calls.push(null);
        return heldResult();
      }
      mocks.calls.push(params);
      return {
        data: undefined,
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        isError: true,
        errorType: type,
        refetch: mocks.refetch,
      };
    },
  );
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const memory = memoryLocation({ path: "/" });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecentSearchesProvider>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <Home />
        </Router>
      </RecentSearchesProvider>
    </QueryClientProvider>,
  );
}

/** Type a train number into the page-1 input and submit with Enter. */
async function searchFor(
  user: ReturnType<typeof userEvent.setup>,
  number: string,
) {
  await user.type(screen.getByTestId("input-train-number"), number);
  await user.keyboard("{Enter}");
}

/** 'YYYY-MM-DD' + `days` offset (may be negative) -> 'YYYYMMDD'. */
function apiDateOffset(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${mm}${dd}`;
}

/** Previous 2 runs, today's run, and the next run (ascending). */
function runWindow(): string[] {
  const today = getUpcomingDates(1)[0];
  return [
    apiDateOffset(today, -14),
    apiDateOffset(today, -7),
    toApiDate(today),
    apiDateOffset(today, 7),
  ];
}

describe("Home", () => {
  beforeEach(() => {
    mocks.useTrainStatus.mockReset();
    mocks.useTrainRuns.mockReset();
    mocks.useTrainRuns.mockReturnValue({
      runs: [],
      isLoading: false,
      isError: false,
    });
    mocks.calls.length = 0;
    mocks.refetch.mockReset();
    mocks.refetch.mockResolvedValue(undefined);
    localStorage.clear();
    document.documentElement.classList.remove("inverted");
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("renders the search page initially: title, input, and no recents", () => {
    mockSuccess();
    renderHome();

    expect(screen.getByTestId("search-title")).toBeInTheDocument();
    expect(screen.getByTestId("input-train-number")).toBeInTheDocument();
    expect(screen.queryByTestId("recent-searches")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-train-number")).not.toBeInTheDocument();
  });

  it("does not navigate while typing; submits only on Enter", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await user.type(screen.getByTestId("input-train-number"), "22943");

    expect(screen.queryByTestId("text-train-number")).not.toBeInTheDocument();
    expect(mocks.calls.filter((call) => call !== null)).toHaveLength(0);

    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("text-train-number")).toHaveTextContent(
      "22943",
    );
    expect(screen.getByTestId("text-train-name")).toHaveTextContent(
      "Indore Intercity SF Express",
    );
    expect(screen.getByTestId("journey-summary")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-UJN")).toBeInTheDocument();
    expect(screen.getByTestId("status-message")).toBeInTheDocument();
    expect(screen.getByTestId("status-delay-badge")).toBeInTheDocument();

    expect(mocks.calls[mocks.calls.length - 1]).toEqual({
      train_number: "22943",
      departure_date: toApiDate(getUpcomingDates(1)[0]),
    });
  });

  it("submits when the search button is clicked", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await user.type(screen.getByTestId("input-train-number"), "22943");
    await user.click(screen.getByTestId("submit-train-search"));

    expect(await screen.findByTestId("text-train-number")).toHaveTextContent(
      "22943",
    );
  });

  it("submits immediately when a train is picked from the autocomplete list", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await user.type(screen.getByTestId("input-train-number"), "2294");
    const option = await screen.findByRole("option", {
      name: /Indore Intercity SF Express/,
    });
    await user.click(option);

    expect(await screen.findByTestId("text-train-number")).toHaveTextContent(
      "22943",
    );
  });

  it("loads a recent chip click and submits it", async () => {
    const user = userEvent.setup();
    mockSuccess();
    localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify([{ number: "12951", name: "Mumbai Rajdhani Express" }]),
    );
    renderHome();

    expect(screen.getByTestId("recent-chip-12951")).toBeInTheDocument();
    expect(screen.getByTestId("recent-chip-name-12951")).toHaveTextContent(
      "Mumbai Rajdhani Express",
    );

    await user.click(screen.getByTestId("recent-chip-12951"));

    expect(await screen.findByTestId("text-train-number")).toHaveTextContent(
      "12951",
    );
  });

  it("renders the error panel with the failure message and a retry button", async () => {
    const user = userEvent.setup();
    mockError("provider");
    renderHome();

    await searchFor(user, "22943");

    const panel = await screen.findByTestId("status-error");
    expect(panel).toHaveTextContent(
      "The train data provider is unreachable. Please try again.",
    );
    expect(screen.getByTestId("status-retry")).toBeInTheDocument();
  });

  it("retry in the error panel force-refetches via the status hook's refetch", async () => {
    const user = userEvent.setup();
    mockError("provider");
    renderHome();

    await searchFor(user, "22943");
    await screen.findByTestId("status-error");

    await user.click(screen.getByTestId("status-retry"));

    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("refresh button force-refetches the current status on click", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await searchFor(user, "22943");
    await screen.findByTestId("text-train-number");

    await user.click(screen.getByTestId("button-refresh"));

    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("shows a skeleton while run dates are loading and holds the status query", async () => {
    const user = userEvent.setup();
    mockSuccess();
    mocks.useTrainRuns.mockReturnValue({
      runs: undefined,
      isLoading: true,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");

    expect(screen.getByTestId("status-skeleton")).toBeInTheDocument();
    expect(mocks.calls.filter((call) => call !== null)).toHaveLength(0);
    expect(screen.queryByTestId("text-train-number")).not.toBeInTheDocument();
  });

  it("queries the most recent run date when the train does not run today", async () => {
    const user = userEvent.setup();
    mockSuccess();
    mocks.useTrainRuns.mockReturnValue({
      runs: ["20260727", "20260730", "20260803", "20260806"],
      isLoading: false,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");

    await screen.findByTestId("text-train-number");
    const lastCall = mocks.calls.filter((call) => call !== null).pop();
    expect(lastCall?.departure_date).not.toBe(toApiDate(getUpcomingDates(1)[0]));
    expect(lastCall?.train_number).toBe("22943");
  });

  it("shows run tabs for the previous 2 runs, the current run, and the next run", async () => {
    const user = userEvent.setup();
    mockSuccess();
    const runs = runWindow();
    mocks.useTrainRuns.mockReturnValue({
      runs,
      isLoading: false,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");

    const selector = await screen.findByTestId("run-selector");
    expect(selector).toBeInTheDocument();
    expect(screen.getByTestId(`tab-date-${runs[0]}`)).toBeInTheDocument();
    expect(screen.getByTestId(`tab-date-${runs[1]}`)).toBeInTheDocument();
    expect(screen.getByTestId(`tab-date-${runs[2]}`)).toHaveTextContent("Today");
    expect(screen.getByTestId(`tab-date-${runs[3]}`)).toHaveTextContent("Next");
    expect(screen.getByTestId(`tab-date-${runs[2]}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clicking a previous run tab queries that run and does not snap back", async () => {
    const user = userEvent.setup();
    mockSuccess();
    const runs = runWindow();
    mocks.useTrainRuns.mockReturnValue({
      runs,
      isLoading: false,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");
    await screen.findByTestId("text-train-number");

    await user.click(screen.getByTestId(`tab-date-${runs[1]}`));

    await waitFor(() => {
      const lastCall = mocks.calls.filter((call) => call !== null).pop();
      expect(lastCall?.departure_date).toBe(runs[1]);
    });
    expect(screen.getByTestId(`tab-date-${runs[1]}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId(`tab-date-${runs[2]}`)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("back button returns to the search page", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await searchFor(user, "22943");
    await screen.findByTestId("text-train-number");

    await user.click(screen.getByTestId("button-new-search"));

    expect(screen.getByTestId("search-title")).toBeInTheDocument();
    expect(screen.queryByTestId("text-train-number")).not.toBeInTheDocument();
  });

  it("inverts the site from the header toggle", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await user.click(screen.getByTestId("button-invert"));

    expect(document.documentElement).toHaveClass("inverted");
    expect(screen.getByTestId("button-invert")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
