import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { I18nProvider } from "@/lib/i18n";
import { RecentSearchesProvider } from "@/context/recent-searches";
import { RECENT_SEARCHES_STORAGE_KEY } from "@/lib/recent-searches";
import { VIEW_PREFERENCE_STORAGE_KEY } from "@/hooks/use-view-preference";
import { getDateWindow, getUpcomingDates, toApiDate } from "@workspace/trains-data";
import type { TrainStatusResponse } from "@workspace/api-client-react";
import Home from "./Home";

const mocks = vi.hoisted(() => ({
  useTrainStatus: vi.fn(),
  useTrainRuns: vi.fn(),
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
        day: 1,
        delay_minutes: null,
        platform: null,
        halt_minutes: null,
        has_departed: false,
      },
    ],
    ...overrides,
  };
}

function mockSuccess() {
  mocks.useTrainStatus.mockImplementation(
    (params: { train_number: string; departure_date: string } | null) => {
      mocks.calls.push(params);
      if (!params) {
        return {
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          isNotFound: false,
          isProviderError: false,
          isNetworkError: false,
          messageKey: null,
        };
      }
      return {
        data: makeResponse({
          train_number: params.train_number,
          departure_date: params.departure_date,
        }),
        isLoading: false,
        isFetching: false,
        isError: false,
        isNotFound: false,
        isProviderError: false,
        isNetworkError: false,
        messageKey: null,
      };
    },
  );
}

function mockPlaceholder() {
  mocks.useTrainStatus.mockImplementation(
    (params: { train_number: string; departure_date: string } | null) => {
      if (!params) {
        return {
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          isNotFound: false,
          isProviderError: false,
          isNetworkError: false,
          messageKey: null,
        };
      }
      return {
        data: makeResponse({
          train_number: params.train_number,
          departure_date: params.departure_date,
        }),
        isLoading: false,
        isFetching: false,
        isPlaceholderData: true,
        isError: false,
        isNotFound: false,
        isProviderError: false,
        isNetworkError: false,
        messageKey: null,
      };
    },
  );
}

function mockError(
  key: "error.trainNotFound" | "error.providerUnreachable" | "error.fallback",
) {
  mocks.useTrainStatus.mockImplementation(
    (params: { train_number: string; departure_date: string } | null) => {
      mocks.calls.push(params);
      return {
        data: undefined,
        isLoading: false,
        isFetching: false,
        isError: true,
        isNotFound: key === "error.trainNotFound",
        isProviderError: key === "error.providerUnreachable",
        isNetworkError: key === "error.fallback",
        messageKey: key,
      };
    },
  );
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RecentSearchesProvider>
          <Router>
            <Home />
          </Router>
        </RecentSearchesProvider>
      </I18nProvider>
    </QueryClientProvider>
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

describe("Home", () => {
  beforeEach(() => {
    mocks.useTrainStatus.mockReset();
    mocks.useTrainRuns.mockReset();
    mocks.useTrainRuns.mockReturnValue({
      runs: undefined,
      isLoading: false,
      isError: false,
    });
    mocks.calls.length = 0;
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("renders the search page initially: title, input, and no recents section", () => {
    mockSuccess();
    renderHome();

    expect(screen.getByTestId("search-title")).toBeInTheDocument();
    expect(screen.getByTestId("input-train-number")).toBeInTheDocument();
    expect(screen.queryByTestId("recent-searches")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-train-number")).not.toBeInTheDocument();
    expect(screen.queryByTestId("date-tabs")).not.toBeInTheDocument();
  });

  it("does not navigate while typing a valid number; submits only on Enter", async () => {
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
    expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
      train_number: "22943",
    });
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
    expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
      train_number: "22943",
    });
  });

  it("shows a refreshing hint instead of a stale timestamp for placeholder data", async () => {
    const user = userEvent.setup();
    mockPlaceholder();
    renderHome();

    await searchFor(user, "22943");

    expect(await screen.findByTestId("text-train-number")).toHaveTextContent(
      "22943",
    );
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(screen.queryByText(/^Updated:/)).not.toBeInTheDocument();
  });

  it("renders the error panel with the i18n message and a retry button", async () => {
    const user = userEvent.setup();
    mockError("error.providerUnreachable");
    renderHome();

    await searchFor(user, "22943");

    const panel = await screen.findByTestId("status-error");
    expect(panel).toHaveTextContent(
      "Train data provider is unreachable. Please try again.",
    );
    expect(
      screen.getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
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
    expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
      train_number: "12951",
    });
  });

  it("searches a new train from the results header without going back", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await searchFor(user, "22943");

    expect(screen.getByTestId("button-new-search")).toBeInTheDocument();
    const compactForm = screen.getByTestId("results-search-form");
    expect(compactForm).toBeInTheDocument();
    expect(compactForm).toHaveAttribute("data-compact", "true");

    await user.type(screen.getByTestId("input-train-number"), "12951");
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("text-train-number")).toHaveTextContent(
      "12951",
    );
    expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
      train_number: "12951",
    });
  });

  it("shows the timeline by default and toggles to the live track view", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await searchFor(user, "22943");

    expect(screen.getByTestId("station-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("track-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("view-timeline")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByTestId("view-track"));

    expect(screen.getByTestId("track-view")).toBeInTheDocument();
    expect(screen.queryByTestId("station-timeline")).not.toBeInTheDocument();
    expect(screen.getByTestId("track-train")).toBeInTheDocument();
    expect(localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY)).toBe("track");

    await user.click(screen.getByTestId("view-timeline"));

    expect(screen.getByTestId("station-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("track-view")).not.toBeInTheDocument();
  });

  it("shows the 7 date tabs (3 past, today, 3 ahead) and refetches when a later date is selected", async () => {
    const user = userEvent.setup();
    mockSuccess();
    renderHome();

    await searchFor(user, "22943");

    const tabs = screen.getAllByTestId(/^tab-date-/);
    expect(tabs).toHaveLength(7);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(
      screen.getByTestId(`tab-date-${toApiDate(getDateWindow(3, 3)[0])}`),
    ).toBeInTheDocument();

    const tomorrowApi = toApiDate(getDateWindow(3, 3)[4]);
    await user.click(screen.getByTestId(`tab-date-${tomorrowApi}`));

    expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
      departure_date: tomorrowApi,
    });
    expect(
      screen.getByTestId(`tab-date-${tomorrowApi}`),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the train's run-date tabs instead of the calendar window", async () => {
    const user = userEvent.setup();
    mockSuccess();
    mocks.useTrainRuns.mockReturnValue({
      runs: ["20260727", "20260730", "20260803", "20260806"],
      isLoading: false,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");

    const tabs = screen.getAllByTestId(/^tab-date-/);
    expect(tabs).toHaveLength(4);
    expect(screen.getByTestId("tab-date-20260727")).toBeInTheDocument();
    expect(screen.getByTestId("tab-date-20260806")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-date-20260805")).not.toBeInTheDocument();
  });

  it("defaults to the most recent run when the train does not run today", async () => {
    const user = userEvent.setup();
    mockSuccess();
    mocks.useTrainRuns.mockReturnValue({
      runs: ["20260727", "20260730", "20260803", "20260806"],
      isLoading: false,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");

    await waitFor(() => {
      expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
        train_number: "22943",
        departure_date: "20260803",
      });
    });
    expect(screen.getByTestId("tab-date-20260803")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("stays on today when the train runs today", async () => {
    const user = userEvent.setup();
    mockSuccess();
    const todayApi = toApiDate(getUpcomingDates(1)[0]);
    mocks.useTrainRuns.mockReturnValue({
      runs: ["20260729", todayApi, "20260812"],
      isLoading: false,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");

    expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
      train_number: "22943",
      departure_date: todayApi,
    });
  });

  it("keeps a date the user picked manually once runs are known", async () => {
    const user = userEvent.setup();
    mockSuccess();
    mocks.useTrainRuns.mockReturnValue({
      runs: ["20260727", "20260730", "20260803", "20260806"],
      isLoading: false,
      isError: false,
    });
    renderHome();

    await searchFor(user, "22943");
    await user.click(screen.getByTestId("tab-date-20260806"));

    expect(screen.getByTestId("tab-date-20260806")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mocks.calls[mocks.calls.length - 1]).toMatchObject({
      departure_date: "20260806",
    });
  });

  it("on mobile collapses the header to a single row and shows the train identity above the schedule", async () => {
    const user = userEvent.setup();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    try {
      mockSuccess();
      renderHome();

      await searchFor(user, "22943");
      await screen.findByTestId("text-train-number");

      expect(screen.getByTestId("train-identity-hero")).toBeInTheDocument();
      expect(screen.getByTestId("text-train-number")).toHaveTextContent(
        "22943",
      );
      expect(screen.getByTestId("results-search-form")).toHaveAttribute(
        "data-compact",
        "true",
      );
      expect(screen.getByTestId("button-new-search")).toBeInTheDocument();
      expect(screen.getByTestId("select-language")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });
});
