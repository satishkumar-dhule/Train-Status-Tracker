import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { NextStopCard } from "./next-stop-card";
import type { StationStatus } from "@workspace/api-client-react";

const stations: StationStatus[] = [
  {
    station_code: "ADI",
    station_name: "Ahmedabad Junction",
    scheduled_arrival: "22:00",
    scheduled_departure: "22:05",
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
    delay_minutes: 0,
    distance_from_source: 230,
    platform: "7",
    halt_minutes: null,
    has_departed: false,
    is_current: false,
    day: 2,
  },
];

function renderCard(currentDistance: number | null = 100) {
  return render(
    <I18nProvider>
      <NextStopCard stations={stations} currentDistance={currentDistance} />
    </I18nProvider>
  );
}

describe("NextStopCard", () => {
  it("shows the next station's name, code, eta and distance ahead", () => {
    renderCard();
    expect(screen.getByText("Next stop")).toBeInTheDocument();
    expect(screen.getByText("Surat")).toBeInTheDocument();
    expect(screen.getByText("ST")).toBeInTheDocument();
    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(screen.getByText("130KM")).toBeInTheDocument();
    expect(screen.getByText("PF 7")).toBeInTheDocument();
  });

  it("hides the platform chip when the next station has no platform", () => {
    const withoutPlatform = stations.map((station) =>
      station.station_code === "ST" ? { ...station, platform: null } : station
    );
    render(
      <I18nProvider>
        <NextStopCard stations={withoutPlatform} currentDistance={100} />
      </I18nProvider>
    );
    expect(screen.getByText("Surat")).toBeInTheDocument();
    expect(screen.queryByText(/^PF/)).not.toBeInTheDocument();
  });

  it("hides the distance when the current distance is unknown", () => {
    renderCard(null);
    expect(screen.getByText("Surat")).toBeInTheDocument();
    expect(screen.queryByText("130KM")).not.toBeInTheDocument();
  });

  it("renders nothing once the train has reached the terminus", () => {
    const complete = stations.map((station) => ({
      ...station,
      is_current: false,
      has_departed: true,
    }));
    const { container } = render(
      <I18nProvider>
        <NextStopCard stations={complete} currentDistance={230} />
      </I18nProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
