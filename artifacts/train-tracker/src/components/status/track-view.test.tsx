import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { TrackView } from "./track-view";
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
    actual_arrival: "23:30",
    actual_departure: "23:40",
    delay_minutes: 20,
    distance_from_source: 100,
    platform: "3",
    halt_minutes: 5,
    has_departed: true,
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
    distance_from_source: 200,
    platform: null,
    halt_minutes: null,
    has_departed: false,
    is_current: false,
    day: 2,
  },
];

const now = new Date(2026, 7, 5, 23, 55);

function renderTrack() {
  return render(
    <I18nProvider>
      <TrackView stations={stations} now={now} />
    </I18nProvider>,
  );
}

describe("TrackView", () => {
  it("renders the railway schematic with rails, a node for every station and the train", () => {
    renderTrack();
    expect(screen.getByTestId("track-view")).toBeInTheDocument();
    expect(screen.getByTestId("track-rail-top")).toBeInTheDocument();
    expect(screen.getByTestId("track-rail-bottom")).toBeInTheDocument();
    expect(screen.getByTestId("track-flow")).toBeInTheDocument();
    expect(screen.getByTestId("track-train")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-ADI")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-BRC")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-ST")).toBeInTheDocument();
  });

  it("labels every station node with its code", () => {
    renderTrack();
    expect(screen.getByTestId("track-label-ADI").textContent).toBe("ADI");
    expect(screen.getByTestId("track-label-BRC").textContent).toBe("BRC");
    expect(screen.getByTestId("track-label-ST").textContent).toBe("ST");
  });

  it("adds a readable current-station strip for mobile", () => {
    renderTrack();
    const strip = screen.getByTestId("track-current-strip");
    expect(strip).toHaveTextContent("Vadodara Junction");
    expect(strip).toHaveTextContent("[BRC]");
    expect(strip).toHaveTextContent("+20 min");
  });

  it("marks the current station with the brand pulse and passed stations as muted", () => {
    renderTrack();
    const current = screen.getByTestId("track-station-BRC");
    expect(current.querySelector(".bg-brand")).not.toBeNull();
    expect(current.querySelector(".ring-brand\\/20")).not.toBeNull();
    expect(current.querySelector(".animate-pulse-fast")).not.toBeNull();

    const passed = screen.getByTestId("track-station-ADI");
    expect(
      passed.querySelector(".bg-muted-foreground\\/50"),
    ).not.toBeNull();
    expect(passed.querySelector(".bg-brand")).toBeNull();
  });

  it("lays stations out across multiple serpentine rows for long routes", () => {
    const longStations = Array.from({ length: 25 }, (_, index) => ({
      ...stations[0],
      station_code: `S${index}`,
      station_name: `Station ${index}`,
      distance_from_source: index * 10,
      is_current: index === 12,
      has_departed: index < 12,
    }));
    render(
      <I18nProvider>
        <TrackView stations={longStations} now={now} />
      </I18nProvider>,
    );
    const view = screen.getByTestId("track-view");
    const svg = view.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(screen.getAllByTestId(/^track-station-(?!hit-)/)).toHaveLength(25);
    expect(screen.getByTestId("track-train")).toBeInTheDocument();
  });

  it("keeps the train between the current and next station and shows the live badge", () => {
    renderTrack();
    const train = screen.getByTestId("track-train");
    const left = Number.parseFloat(train.style.left);
    expect(Number.isFinite(left)).toBe(true);

    const current = screen.getByTestId("track-station-BRC");
    const next = screen.getByTestId("track-station-ST");
    const currentLeft = Number.parseFloat(current.style.left);
    const nextLeft = Number.parseFloat(next.style.left);
    expect(left).toBeGreaterThan(currentLeft);
    expect(left).toBeLessThan(nextLeft);

    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("hides the live badge when the status data is stale or placeholder", () => {
    render(
      <I18nProvider>
        <TrackView stations={stations} now={now} isLiveData={false} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("track-train")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  it("marks the current station label as prominent", () => {
    renderTrack();
    const label = screen.getByTestId("track-label-BRC");
    expect(label).toHaveTextContent("BRC");
    expect(label.className).toContain("text-primary");
    expect(label.className).toContain("font-bold");
  });

  it("provides a tap target on every station node", () => {
    renderTrack();
    expect(screen.getByTestId("track-station-hit-ADI")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-hit-BRC")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-hit-ST")).toBeInTheDocument();
  });

  it("reveals station details in a tooltip on hover", async () => {
    const user = userEvent.setup();
    renderTrack();

    await user.hover(screen.getByTestId("track-station-hit-BRC"));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Vadodara Junction");
    expect(tooltip).toHaveTextContent("+20 min");
    expect(tooltip).toHaveTextContent("PF 3");
    expect(tooltip).toHaveTextContent("100KM");
  });

  it("renders nothing for an empty route", () => {
    const { container } = render(
      <I18nProvider>
        <TrackView stations={[]} now={now} />
      </I18nProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a completed-run strip with the final delay for a past run", () => {
    const completedStations: StationStatus[] = stations.map((station, index) => ({
      ...station,
      has_departed: true,
      is_current: false,
      delay_minutes: index === stations.length - 1 ? 15 : station.delay_minutes,
    }));
    render(
      <I18nProvider>
        <TrackView stations={completedStations} now={now} />
      </I18nProvider>,
    );

    expect(
      screen.getByTestId("track-completed-strip"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("track-current-strip")).not.toBeInTheDocument();
    expect(screen.getByText("+15 min")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });
});
