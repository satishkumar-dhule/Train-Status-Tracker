import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DelayBadge } from "./delay-badge";

describe("DelayBadge", () => {
  it("renders a late badge with the warning color for a positive delay", () => {
    render(<DelayBadge delayMinutes={10} />);

    const badge = screen.getByText("+10 min");
    expect(badge).toHaveAttribute("data-variant", "late");
    expect(badge).toHaveClass("bg-warning", "text-warning-foreground");
  });

  it("renders an on-time badge with the success color for zero or early delay", () => {
    const { rerender } = render(<DelayBadge delayMinutes={0} />);

    expect(screen.getByText("On time")).toHaveAttribute(
      "data-variant",
      "on-time",
    );
    expect(screen.getByText("On time")).toHaveClass(
      "bg-success",
      "text-success-foreground",
    );

    rerender(<DelayBadge delayMinutes={-5} />);
    expect(screen.getByText("On time")).toHaveAttribute(
      "data-variant",
      "on-time",
    );
  });

  it("renders nothing when the delay is unknown", () => {
    const { rerender } = render(<DelayBadge delayMinutes={null} />);
    expect(screen.queryByText(/min|On time/)).not.toBeInTheDocument();

    rerender(<DelayBadge delayMinutes={undefined} />);
    expect(screen.queryByText(/min|On time/)).not.toBeInTheDocument();
  });
});
