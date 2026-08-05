import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { StationTimeline } from "./station-timeline";
import type { StationStatus } from "@workspace/api-client-react";

const stations: StationStatus[] = [
  {
    station_code: "ADI",
    station_name: "Ahmedabad Junction",
    scheduled_arrival: "22:00",
    scheduled_departure: "22:05",
    actual_arrival: "22:00",
    actual_departure: "22:05",
    delay_minutes: 0,
    distance_from_source: 0,
    platform: "1",
    halt_minutes: 5,
    has_departed: true,
    is_current: false,
    day: 1,
  },
  {
    station_code: "BRC",
    station_name: "Vadodara Junction",
    scheduled_arrival: "23:30",
    scheduled_departure: "23:35",
    actual_arrival: "23:50",
    actual_departure: null,
    delay_minutes: 20,
    distance_from_source: 100,
    platform: "3",
    halt_minutes: 5,
    has_departed: false,
    is_current: true,
    day: 1,
  },
  {
    station_code: "ST",
    station_name: "Surat",
    scheduled_arrival: "01:30",
    scheduled_departure: "01:35",
    actual_arrival: null,
    actual_departure: null,
    delay_minutes: 0,
    distance_from_source: 230,
    platform: null,
    halt_minutes: null,
    has_departed: false,
    is_current: false,
    day: 2,
  },
];

describe("StationTimeline", () => {
  it("renders a row for every station", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    expect(screen.getByTestId("station-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-ADI")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-BRC")).toBeInTheDocument();
    expect(screen.getByTestId("row-station-ST")).toBeInTheDocument();
  });

  it("marks passed, current and upcoming stations distinctly", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    const passed = screen.getByTestId("row-station-ADI");
    expect(passed).toHaveClass("opacity-60");
    expect(passed.querySelector(".animate-pulse-fast")).toBeNull();
    expect(passed.querySelector(".ring-4")).toBeNull();

    const current = screen.getByTestId("row-station-BRC");
    expect(current).not.toHaveClass("opacity-60");
    expect(current.querySelector(".animate-pulse-fast")).not.toBeNull();
    expect(current.querySelector(".ring-primary\\/20")).not.toBeNull();

    const upcoming = screen.getByTestId("row-station-ST");
    expect(upcoming).not.toHaveClass("opacity-60");
    expect(upcoming.querySelector(".animate-pulse-fast")).toBeNull();
    expect(upcoming.querySelector(".border-2")).not.toBeNull();
  });

  it("shows a per-station delay badge and an on-time badge for departed stations", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    expect(screen.getByText("20M late")).toBeInTheDocument();
    expect(screen.getByText("On time")).toBeInTheDocument();
  });

  it("renders a day badge when day > 1 and plain day text otherwise", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    expect(screen.getByText("Day 2")).toBeInTheDocument();
    expect(screen.getAllByText("Day 1")).toHaveLength(2);
  });

  it("shows the ACT label with the actual time when it differs from scheduled", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    expect(screen.getByText("23:50")).toBeInTheDocument();
    expect(screen.getByText("ACT")).toBeInTheDocument();
    expect(screen.queryAllByText("ACT")).toHaveLength(1);
  });
});
