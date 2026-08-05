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
    expect(passed).toHaveClass("text-muted-foreground/60");
    expect(passed.querySelector(".bg-muted-foreground\\/30")).not.toBeNull();
    expect(passed.querySelector(".animate-pulse-fast")).toBeNull();
    expect(passed.querySelector(".ring-4")).toBeNull();

    const current = screen.getByTestId("row-station-BRC");
    expect(current).not.toHaveClass("text-muted-foreground/60");
    expect(current).toHaveClass("bg-brand-soft/50");
    expect(current.querySelector(".animate-pulse-fast")).not.toBeNull();
    expect(current.querySelector(".ring-brand\\/20")).not.toBeNull();

    const upcoming = screen.getByTestId("row-station-ST");
    expect(upcoming).not.toHaveClass("text-muted-foreground/60");
    expect(upcoming.querySelector(".animate-pulse-fast")).toBeNull();
    expect(upcoming.querySelector(".border-2")).not.toBeNull();
  });

  it("shows a green On-time pill for departed stations that were on time", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    expect(screen.getByText("+20 min")).toBeInTheDocument();
    const onTimePill = screen.getByText("On time");
    expect(onTimePill).toBeInTheDocument();
    expect(onTimePill.className).toContain("bg-success");
    expect(screen.queryAllByText("On time")).toHaveLength(1);
  });

  it("renders a day badge only when day > 1", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    expect(screen.getByText("Day 2")).toBeInTheDocument();
    expect(screen.queryByText("Day 1")).not.toBeInTheDocument();
  });

  it("shows delay badges for late departed stations and green On-time pills for on-time ones in a past run", () => {
    const pastRun: StationStatus[] = [
      {
        station_code: "NDLS",
        station_name: "New Delhi",
        scheduled_arrival: "06:00",
        scheduled_departure: "06:05",
        actual_arrival: "06:15",
        actual_departure: "06:15",
        delay_minutes: 15,
        distance_from_source: 0,
        platform: "1",
        halt_minutes: 5,
        has_departed: true,
        is_current: false,
        day: 1,
      },
      {
        station_code: "CNB",
        station_name: "Kanpur Central",
        scheduled_arrival: "10:00",
        scheduled_departure: "10:05",
        actual_arrival: "10:00",
        actual_departure: "10:05",
        delay_minutes: 0,
        distance_from_source: 440,
        platform: "2",
        halt_minutes: 5,
        has_departed: true,
        is_current: false,
        day: 1,
      },
      {
        station_code: "ALH",
        station_name: "Allahabad Junction",
        scheduled_arrival: "13:00",
        scheduled_departure: "13:05",
        actual_arrival: null,
        actual_departure: null,
        delay_minutes: null,
        distance_from_source: 630,
        platform: null,
        halt_minutes: null,
        has_departed: true,
        is_current: false,
        day: 2,
      },
    ];

    render(
      <I18nProvider>
        <StationTimeline stations={pastRun} />
      </I18nProvider>
    );

    expect(screen.getByText("+15 min")).toBeInTheDocument();

    const onTimeRow = screen.getByTestId("row-station-CNB");
    expect(onTimeRow.querySelector(".bg-success")).not.toBeNull();
    expect(onTimeRow.querySelector(".bg-warning")).toBeNull();

    const unknownRow = screen.getByTestId("row-station-ALH");
    expect(unknownRow.querySelector(".bg-success")).toBeNull();
    expect(unknownRow.querySelector(".bg-warning")).toBeNull();

    expect(screen.queryAllByText("On time")).toHaveLength(1);
  });

  it("shows a platform chip when present and hides it when unknown", () => {
    render(
      <I18nProvider>
        <StationTimeline stations={stations} />
      </I18nProvider>
    );
    expect(screen.getByText("PF 1")).toBeInTheDocument();
    expect(screen.getByText("PF 3")).toBeInTheDocument();
    expect(screen.queryByText("PF 0")).not.toBeInTheDocument();
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
