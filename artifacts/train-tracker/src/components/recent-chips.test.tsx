import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrainEntry } from "@workspace/trains-data";
import { RecentChips } from "./recent-chips";

const LONG_TRAIN: TrainEntry = {
  number: "12301",
  name: "Howrah New Delhi Rajdhani Express via Gaya Junction And Kanpur Central",
};

describe("RecentChips", () => {
  it("renders every chip with its full, untruncated name", () => {
    const recent: TrainEntry[] = [
      LONG_TRAIN,
      { number: "22943", name: "Indore Intercity SF Express" },
    ];
    render(<RecentChips recent={recent} onSelect={() => {}} />);

    expect(screen.getByTestId("recent-chip-12301")).toBeInTheDocument();
    expect(screen.getByTestId("recent-chip-22943")).toBeInTheDocument();

    // The full long name must be visible in the document, never clipped.
    expect(screen.getByText(LONG_TRAIN.name)).toBeInTheDocument();
    expect(screen.getByText("Indore Intercity SF Express")).toBeInTheDocument();

    // The name span must not use a truncation utility and must allow wrapping.
    const nameEl = screen.getByTestId("recent-chip-name-12301");
    expect(nameEl).not.toHaveClass("truncate");
    expect(nameEl).toHaveClass("whitespace-normal");
  });

  it("calls onSelect with the clicked train", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RecentChips recent={[LONG_TRAIN]} onSelect={onSelect} />);

    await user.click(screen.getByTestId("recent-chip-12301"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(LONG_TRAIN);
  });
});
