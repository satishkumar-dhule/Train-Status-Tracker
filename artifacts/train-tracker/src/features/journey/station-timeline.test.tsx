import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StatusStationLike } from "@/lib/status-metrics";
import { StationTimeline } from "./station-timeline";

const CODES = [
  "INDB",
  "UJN",
  "RTA",
  "BPL",
  "ET",
  "NGP",
  "WRD",
  "BKIT",
  "NED",
  "PAU",
];

function makeStation(
  index: number,
  overrides: Partial<StatusStationLike> = {},
): StatusStationLike {
  return {
    station_code: CODES[index],
    station_name: `${CODES[index]} Station`,
    scheduled_arrival: index === 0 ? null : "0" + String(index + 1) + ":15",
    scheduled_departure: "1" + String(index + 1) + ":30",
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: index * 50,
    is_current: false,
    day: 1,
    delay_minutes: null,
    platform: String((index % 5) + 1),
    halt_minutes: 5,
    has_departed: false,
    ...overrides,
  };
}

function makeStations(): StatusStationLike[] {
  const stations = CODES.map((_, index) => makeStation(index));
  stations[0] = makeStation(0, {
    delay_minutes: 5,
    has_departed: true,
    actual_departure: "06:05",
  });
  stations[4] = makeStation(4, {
    is_current: true,
    delay_minutes: 0,
    actual_arrival: "08:45",
  });
  stations[2] = makeStation(2, { day: 2 });
  return stations;
}

function rowsIn(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid^="row-station-"]'),
  ).map((el) => el.getAttribute("data-testid") ?? "");
}

function Harness() {
  const [showAll, setShowAll] = useState(false);
  return (
    <StationTimeline
      stations={STATIONS}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((value) => !value)}
    />
  );
}

const STATIONS = makeStations();

describe("StationTimeline", () => {
  it("renders the container, header label, and every row when under the limit", () => {
    render(
      <StationTimeline
        stations={STATIONS.slice(0, 3)}
        showAll={false}
        onToggleShowAll={() => {}}
      />,
    );

    expect(screen.getByTestId("station-timeline")).toBeInTheDocument();
    expect(screen.getByText("Scheduled · Actual")).toBeInTheDocument();
    expect(rowsIn(document.body)).toEqual([
      "row-station-INDB",
      "row-station-UJN",
      "row-station-RTA",
    ]);
    expect(screen.queryByTestId("all-stations-toggle")).not.toBeInTheDocument();
  });

  it("collapses to the stations around the current one when not showing all", () => {
    render(
      <StationTimeline
        stations={STATIONS}
        showAll={false}
        onToggleShowAll={() => {}}
      />,
    );

    expect(rowsIn(document.body)).toEqual([
      "row-station-RTA",
      "row-station-BPL",
      "row-station-ET",
      "row-station-NGP",
      "row-station-WRD",
    ]);

    const toggle = screen.getByTestId("all-stations-toggle");
    expect(toggle).toHaveTextContent("Show all 10 stations");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the first maxVisible stations when there is no current station", () => {
    const noCurrent = STATIONS.map((station) => ({
      ...station,
      is_current: false,
    }));

    render(
      <StationTimeline
        stations={noCurrent}
        showAll={false}
        onToggleShowAll={() => {}}
      />,
    );

    expect(rowsIn(document.body)).toHaveLength(7);
    expect(screen.getByTestId("row-station-INDB")).toBeInTheDocument();
    expect(screen.queryByTestId("row-station-NED")).not.toBeInTheDocument();
  });

  it("expanding calls onToggleShowAll and shows every row when showAll is true", async () => {
    const user = userEvent.setup();
    const onToggleShowAll = vi.fn();
    const { rerender } = render(
      <StationTimeline
        stations={STATIONS}
        showAll={false}
        onToggleShowAll={onToggleShowAll}
      />,
    );

    await user.click(screen.getByTestId("all-stations-toggle"));
    expect(onToggleShowAll).toHaveBeenCalledTimes(1);

    rerender(
      <StationTimeline
        stations={STATIONS}
        showAll={true}
        onToggleShowAll={onToggleShowAll}
      />,
    );
    expect(rowsIn(document.body)).toHaveLength(10);
    expect(screen.getByTestId("all-stations-toggle")).toHaveTextContent(
      "Show fewer",
    );
    expect(screen.getByTestId("all-stations-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("toggles between collapsed and all rows in a stateful harness", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(rowsIn(document.body)).toHaveLength(5);
    expect(screen.getByTestId("all-stations-toggle")).toHaveTextContent(
      "Show all 10 stations",
    );

    await user.click(screen.getByTestId("all-stations-toggle"));
    expect(rowsIn(document.body)).toHaveLength(10);
    expect(screen.getByTestId("all-stations-toggle")).toHaveTextContent(
      "Show fewer",
    );

    await user.click(screen.getByTestId("all-stations-toggle"));
    expect(rowsIn(document.body)).toHaveLength(5);
    expect(screen.getByTestId("all-stations-toggle")).toHaveTextContent(
      "Show all 10 stations",
    );
  });

  it("preserves row testids and highlights the current station row", () => {
    render(
      <StationTimeline
        stations={STATIONS}
        showAll={true}
        onToggleShowAll={() => {}}
      />,
    );

    for (const code of CODES) {
      expect(screen.getByTestId(`row-station-${code}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("row-station-ET")).toHaveClass("bg-muted/60");
    expect(screen.getByTestId("row-station-INDB")).not.toHaveClass(
      "bg-muted/60",
    );
  });

  it("renders the delay pill phrase per station and announces only on the current one", () => {
    render(
      <StationTimeline
        stations={STATIONS}
        showAll={true}
        onToggleShowAll={() => {}}
      />,
    );

    const late = within(screen.getByTestId("row-station-INDB"));
    expect(late.getByText("5 min late")).toBeInTheDocument();
    expect(late.getByText("5 min late").closest("span")).not.toHaveAttribute(
      "role",
      "status",
    );

    const current = within(screen.getByTestId("row-station-ET"));
    expect(current.getByText("On time")).toBeInTheDocument();
    expect(current.getByText("On time").closest("span")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("shows day, platform, halt, and scheduled time in each row", () => {
    render(
      <StationTimeline
        stations={STATIONS}
        showAll={true}
        onToggleShowAll={() => {}}
      />,
    );

    expect(screen.getByTestId("row-station-ET")).toHaveTextContent("05:15");
    expect(screen.getByTestId("row-station-ET")).toHaveTextContent("PF 5");
    expect(screen.getByTestId("row-station-ET")).toHaveTextContent("Halt 5 min");
    expect(screen.getByTestId("row-station-RTA")).toHaveTextContent("Day 2");
  });

  it("renders an empty card without throwing", () => {
    render(
      <StationTimeline
        stations={[]}
        showAll={false}
        onToggleShowAll={() => {}}
      />,
    );

    expect(screen.getByTestId("station-timeline")).toBeInTheDocument();
    expect(rowsIn(document.body)).toHaveLength(0);
    expect(screen.queryByTestId("all-stations-toggle")).not.toBeInTheDocument();
  });
});
