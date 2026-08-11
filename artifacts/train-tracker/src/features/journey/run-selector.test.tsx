import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSelector, type RunTab } from "./run-selector";

const DATES: RunTab[] = [
  { apiDate: "20260727", iso: "2026-07-27", label: "27 Jul" },
  { apiDate: "20260803", iso: "2026-08-03", label: "3 Aug" },
  {
    apiDate: "20260807",
    iso: "2026-08-07",
    label: "Today",
    isDefault: true,
    isSelected: true,
  },
  { apiDate: "20260810", iso: "2026-08-10", label: "Next" },
];

describe("RunSelector", () => {
  it("renders one button per run date with the correct testid", () => {
    render(<RunSelector dates={DATES} onSelect={() => {}} />);

    expect(screen.getByTestId("run-selector")).toBeInTheDocument();
    expect(screen.getByRole("group")).toHaveAttribute(
      "aria-label",
      "Departure date",
    );
    expect(screen.getByTestId("tab-date-20260727")).toHaveTextContent("27 Jul");
    expect(screen.getByTestId("tab-date-20260803")).toHaveTextContent("3 Aug");
    expect(screen.getByTestId("tab-date-20260807")).toHaveTextContent("Today");
    expect(screen.getByTestId("tab-date-20260810")).toHaveTextContent("Next");
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("fires onSelect with the apiDate on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RunSelector dates={DATES} onSelect={onSelect} />);

    await user.click(screen.getByTestId("tab-date-20260803"));

    expect(onSelect).toHaveBeenCalledWith("20260803");
  });

  it("reflects isSelected via aria-pressed", () => {
    render(<RunSelector dates={DATES} onSelect={() => {}} />);

    expect(screen.getByTestId("tab-date-20260807")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("tab-date-20260727")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows a Recommended hint on the default date when not selected", () => {
    const { rerender } = render(<RunSelector dates={DATES} onSelect={() => {}} />);

    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();

    const unselected = DATES.map((date) => ({
      ...date,
      isSelected: false,
    }));
    rerender(<RunSelector dates={unselected} onSelect={() => {}} />);

    expect(screen.getByText("Recommended")).toBeInTheDocument();
  });

  it("keeps only the selected date tabbable and the rest at tabindex -1", () => {
    render(<RunSelector dates={DATES} onSelect={() => {}} />);

    expect(screen.getByTestId("tab-date-20260807")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("tab-date-20260727")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByTestId("tab-date-20260803")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByTestId("tab-date-20260810")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("makes the first date tabbable when nothing is selected", () => {
    const unselected = DATES.map((date) => ({ ...date, isSelected: false }));
    render(<RunSelector dates={unselected} onSelect={() => {}} />);

    expect(screen.getByTestId("tab-date-20260727")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("tab-date-20260803")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("moves selection on arrow keys, firing onSelect with the next date", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RunSelector dates={DATES} onSelect={onSelect} />);

    screen.getByTestId("tab-date-20260807").focus();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenCalledWith("20260810");

    screen.getByTestId("tab-date-20260810").focus();
    await user.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenCalledWith("20260807");
  });

  it("renders nothing for an empty dates array without throwing", () => {
    const { container } = render(<RunSelector dates={[]} onSelect={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });
});
