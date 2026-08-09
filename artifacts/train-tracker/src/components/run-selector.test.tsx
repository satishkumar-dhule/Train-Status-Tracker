import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSelector, type RunTab } from "./run-selector";

const DATES: RunTab[] = [
  { apiDate: "20260727", iso: "2026-07-27", label: "27 Jul" },
  { apiDate: "20260803", iso: "2026-08-03", label: "3 Aug" },
  { apiDate: "20260807", iso: "2026-08-07", label: "Today", sub: "7 Aug" },
  { apiDate: "20260810", iso: "2026-08-10", label: "Next", sub: "10 Aug" },
];

describe("RunSelector", () => {
  it("renders one tab per run date with its label", () => {
    render(<RunSelector dates={DATES} active="20260807" onChange={() => {}} />);

    expect(screen.getByTestId("run-selector")).toBeInTheDocument();
    expect(screen.getByTestId("tab-date-20260727")).toHaveTextContent("27 Jul");
    expect(screen.getByTestId("tab-date-20260803")).toHaveTextContent("3 Aug");
    expect(screen.getByTestId("tab-date-20260807")).toHaveTextContent("Today");
    expect(screen.getByTestId("tab-date-20260810")).toHaveTextContent("Next");
  });

  it("marks the active tab as pressed and styled active", () => {
    render(<RunSelector dates={DATES} active="20260807" onChange={() => {}} />);

    expect(screen.getByTestId("tab-date-20260807")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("tab-date-20260807")).toHaveClass("bg-primary");
    expect(screen.getByTestId("tab-date-20260727")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("notifies the parent when a run tab is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RunSelector dates={DATES} active="20260807" onChange={onChange} />);

    await user.click(screen.getByTestId("tab-date-20260803"));

    expect(onChange).toHaveBeenCalledWith("20260803");
  });
});
