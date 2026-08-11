import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrainEntry } from "@workspace/trains-data";
import { RECENT_SEARCHES_STORAGE_KEY } from "@/lib/recent-searches";
import type { SuggestionItem } from "./search-slice";
import { RecentTrains } from "./recent-trains";

const RECENT: TrainEntry[] = [
  { number: "12951", name: "Mumbai Rajdhani Express" },
  { number: "22943", name: "Indore Intercity SF Express" },
];

function toItems(trains: TrainEntry[]): SuggestionItem[] {
  return trains.map((train) => ({
    id: `recent-${train.number}`,
    trainNumber: train.number,
    trainName: train.name,
    type: "recent",
    highlight: { number: [], name: [] },
  }));
}

describe("RecentTrains", () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("renders the recents group with rows and testids", () => {
    render(
      <RecentTrains
        items={toItems(RECENT)}
        startIndex={0}
        highlightedIndex={-1}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("search-recents")).toBeInTheDocument();
    expect(screen.getByTestId("recent-row-12951")).toHaveTextContent(
      "Mumbai Rajdhani Express",
    );
    expect(screen.getByTestId("recent-row-22943")).toHaveTextContent(
      "Indore Intercity SF Express",
    );
  });

  it("marks the highlighted row and fires onSelect on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RecentTrains
        items={toItems(RECENT)}
        startIndex={0}
        highlightedIndex={1}
        onSelect={onSelect}
      />,
    );

    const row = screen.getByRole("option", { name: /Indore Intercity/ });
    expect(row).toHaveAttribute("aria-selected", "true");
    await user.click(row);

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ trainNumber: "22943", type: "recent" }),
    );
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(
      <RecentTrains
        items={[]}
        startIndex={0}
        highlightedIndex={-1}
        onSelect={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
