import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { JourneySummary } from "./journey-summary";
import type { StationStatus } from "@workspace/api-client-react";

const current: StationStatus = {
  station_code: "ADI",
  station_name: "Ahmedabad Junction",
  scheduled_arrival: "10:00",
  scheduled_departure: "10:05",
  actual_arrival: "10:00",
  actual_departure: "10:05",
  delay_minutes: 0,
  distance_from_source: 100,
  platform: "4",
  halt_minutes: 5,
  has_departed: true,
  is_current: true,
  day: 1,
};

describe("JourneySummary", () => {
  it("renders all stats with values and applies formatDuration", () => {
    render(
      <I18nProvider>
        <JourneySummary
          currentStation={current}
          totalDistance={250}
          currentDistance={100}
          durationMinutes={510}
          scheduledDeparture="22:00"
          scheduledArrival="06:30"
          stationCount={12}
        />
      </I18nProvider>
    );
    const grid = screen.getByTestId("journey-summary");
    expect(grid).toBeInTheDocument();
    expect(screen.getByText("Ahmedabad Junction")).toBeInTheDocument();
    expect(screen.getByText("[ADI]")).toBeInTheDocument();
    expect(screen.getByText("100/250")).toBeInTheDocument();
    expect(screen.getByText("8h 30m")).toBeInTheDocument();
    expect(screen.getByText("22:00 → 06:30")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows -- for missing values", () => {
    render(
      <I18nProvider>
        <JourneySummary
          currentStation={null}
          totalDistance={null}
          currentDistance={null}
          durationMinutes={null}
          scheduledDeparture={null}
          scheduledArrival={null}
          stationCount={3}
        />
      </I18nProvider>
    );
    expect(screen.getAllByText("--")).toHaveLength(3);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the total distance when only total is known", () => {
    render(
      <I18nProvider>
        <JourneySummary
          currentStation={null}
          totalDistance={550}
          currentDistance={null}
          durationMinutes={null}
          scheduledDeparture={null}
          scheduledArrival={null}
          stationCount={7}
        />
      </I18nProvider>
    );
    expect(screen.getByText("550")).toBeInTheDocument();
  });
});
