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
  it("renders the serpentine ribbon with a node for every station and the train", () => {
    renderTrack();
    expect(screen.getByTestId("track-view")).toBeInTheDocument();
    expect(screen.getByTestId("track-path")).toBeInTheDocument();
    expect(screen.getByTestId("track-line-progress")).toBeInTheDocument();
    expect(screen.getByTestId("track-train")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-ADI")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-BRC")).toBeInTheDocument();
    expect(screen.getByTestId("track-station-ST")).toBeInTheDocument();
  });

  it("shows every station name on the ribbon", () => {
    renderTrack();
    expect(screen.getByTestId("track-label-ADI").textContent).toBe(
      "Ahmedabad Junction",
    );
    expect(screen.getByTestId("track-label-BRC").textContent).toBe(
      "Vadodara Junction",
    );
    expect(screen.getByTestId("track-label-ST").textContent).toBe("Surat");
  });

  it("adds a readable current-station strip for mobile", () => {
    renderTrack();
    const strip = screen.getByTestId("track-current-strip");
    expect(strip).toHaveTextContent("Vadodara Junction");
    expect(strip).toHaveTextContent("[BRC]");
  });

  it("marks the current station with the brand pulse and passed stations as muted", () => {
    renderTrack();
    const current = screen.getByTestId("track-station-BRC");
    expect(current.querySelector(".fill-brand")).not.toBeNull();
    expect(current.querySelector(".fill-brand\\/20")).not.toBeNull();

    const passed = screen.getByTestId("track-station-ADI");
    expect(passed.querySelector(".fill-muted-foreground\\/50")).not.toBeNull();
    expect(passed.querySelector(".fill-brand")).toBeNull();
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
    const transform = train.getAttribute("transform") ?? "";
    const match = transform.match(/translate\(([\d.]+) ([\d.]+)\)/);
    expect(match).not.toBeNull();
    const x = Number(match?.[1]);
    const stNode = screen.getByTestId("track-station-ST");
    const stTransform = stNode.getAttribute("transform") ?? "";
    const stMatch = stTransform.match(/translate\(([\d.]+) ([\d.]+)\)/);
    const stX = Number(stMatch?.[1]);
    expect(x).toBeLessThan(stX);
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

  it("shows the current station name as the prominent label", () => {
    renderTrack();
    expect(screen.getByTestId("track-label-BRC")).toHaveTextContent(
      "Vadodara Junction",
    );
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
    expect(tooltip).toHaveTextContent("20M late");
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
});
