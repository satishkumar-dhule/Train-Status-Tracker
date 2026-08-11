import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { StatusStationLike } from "@/lib/status-metrics";
import { JourneyRoute } from "./journey-route";

const STATIONS: StatusStationLike[] = [
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
    is_current: false,
    day: 1,
    delay_minutes: null,
    platform: "2",
    halt_minutes: 5,
    has_departed: true,
  },
  {
    station_code: "BPL",
    station_name: "Bhopal Jn",
    scheduled_arrival: "10:30",
    scheduled_departure: "10:35",
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: 304,
    is_current: true,
    day: 2,
    delay_minutes: null,
    platform: "3",
    halt_minutes: 5,
    has_departed: false,
  },
  {
    station_code: "ET",
    station_name: "Itarsi Jn",
    scheduled_arrival: "12:10",
    scheduled_departure: "12:15",
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: 366,
    is_current: false,
    day: 2,
    delay_minutes: null,
    platform: null,
    halt_minutes: 5,
    has_departed: false,
  },
  {
    station_code: "NGP",
    station_name: "Nagpur",
    scheduled_arrival: "16:20",
    scheduled_departure: null,
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: 664,
    is_current: false,
    day: 2,
    delay_minutes: null,
    platform: "4",
    halt_minutes: null,
    has_departed: false,
  },
];

function segmentTestIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid^="route-segment-"]'),
  ).map((el) => el.getAttribute("data-testid") ?? "");
}

function segmentBar(testId: string): HTMLElement {
  const segment = screen.getByTestId(testId);
  const bar = segment.firstElementChild;
  if (!(bar instanceof HTMLElement)) {
    throw new Error(`No bar inside ${testId}`);
  }
  return bar;
}

describe("JourneyRoute", () => {
  it("renders wrapper testids and one segment per leg with the arriving station code", () => {
    const { container } = render(
      <JourneyRoute stations={STATIONS} currentIndex={2} nextIndex={3} />,
    );

    expect(screen.getByTestId("journey-route")).toBeInTheDocument();
    expect(screen.getByTestId("progress-bar")).toBeInTheDocument();

    const segments = segmentTestIds(container);
    expect(segments).toHaveLength(STATIONS.length - 1);
    expect(segments).toEqual([
      "route-segment-UJN",
      "route-segment-BPL",
      "route-segment-ET",
      "route-segment-NGP",
    ]);
    for (const code of ["UJN", "BPL", "ET", "NGP"]) {
      expect(screen.getByTestId(`route-segment-${code}`)).toBeInTheDocument();
    }
  });

  it("colors passed legs on-time, ahead legs muted, and marks the current leg", () => {
    render(<JourneyRoute stations={STATIONS} currentIndex={2} nextIndex={3} />);

    expect(segmentBar("route-segment-UJN")).toHaveClass("bg-success");
    expect(segmentBar("route-segment-BPL")).toHaveClass("bg-success");
    expect(segmentBar("route-segment-UJN")).not.toHaveClass("bg-muted");

    expect(segmentBar("route-segment-NGP")).toHaveClass("bg-muted");
    expect(segmentBar("route-segment-NGP")).not.toHaveClass("bg-success");

    const current = screen.getByTestId("route-segment-ET");
    expect(segmentBar("route-segment-ET")).toHaveClass("bg-muted");
    const marker = within(current).getByTestId("route-marker");
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveClass("bg-success");
    expect(marker).toHaveClass("animate-pulse");
    expect(marker).toHaveClass("motion-reduce:animate-none");
  });

  it("renders the marker only when currentIndex is set", () => {
    render(
      <JourneyRoute stations={STATIONS} currentIndex={null} nextIndex={null} />,
    );

    expect(screen.queryByTestId("route-marker")).not.toBeInTheDocument();
    for (const code of ["UJN", "BPL", "ET", "NGP"]) {
      expect(segmentBar(`route-segment-${code}`)).toHaveClass("bg-muted");
    }
  });

  it("shows the origin and destination names plus the current station name", () => {
    render(<JourneyRoute stations={STATIONS} currentIndex={2} nextIndex={3} />);

    expect(screen.getByText("Indore Jn")).toBeInTheDocument();
    expect(screen.getByText("Nagpur")).toBeInTheDocument();
    expect(screen.getByText("Bhopal Jn")).toBeInTheDocument();
  });

  it("omits the current station name when currentIndex is null", () => {
    render(
      <JourneyRoute stations={STATIONS} currentIndex={null} nextIndex={null} />,
    );

    expect(screen.getByText("Indore Jn")).toBeInTheDocument();
    expect(screen.getByText("Nagpur")).toBeInTheDocument();
    expect(screen.queryByText("Bhopal Jn")).not.toBeInTheDocument();
  });

  it("names the next stop in the accessible label when nextIndex is known", () => {
    const { rerender } = render(
      <JourneyRoute stations={STATIONS} currentIndex={2} nextIndex={3} />,
    );

    expect(screen.getByTestId("journey-route")).toHaveAttribute(
      "aria-label",
      "Journey progress, next stop Itarsi Jn",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rerender(
      <JourneyRoute stations={STATIONS} currentIndex={2} nextIndex={null} />,
    );
    expect(screen.getByTestId("journey-route")).toHaveAttribute(
      "aria-label",
      "Journey progress",
    );
  });

  it("renders no fill bar or percentage text", () => {
    render(<JourneyRoute stations={STATIONS} currentIndex={2} nextIndex={3} />);

    expect(screen.queryByTestId("progress-bar-fill")).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("renders an empty wrapper for empty and single-station lists", () => {
    const { rerender } = render(
      <JourneyRoute stations={[]} currentIndex={null} nextIndex={null} />,
    );

    expect(screen.getByTestId("journey-route")).toBeInTheDocument();
    expect(segmentTestIds(document.body)).toHaveLength(0);

    rerender(
      <JourneyRoute
        stations={[STATIONS[0]]}
        currentIndex={0}
        nextIndex={null}
      />,
    );

    expect(screen.getByTestId("journey-route")).toBeInTheDocument();
    expect(segmentTestIds(document.body)).toHaveLength(0);
  });
});
