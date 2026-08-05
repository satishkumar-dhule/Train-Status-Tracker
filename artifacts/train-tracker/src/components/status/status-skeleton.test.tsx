import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusSkeleton } from "./status-skeleton";

describe("StatusSkeleton", () => {
  it("renders a skeleton mirroring the status layout", () => {
    const { container } = render(<StatusSkeleton />);
    expect(screen.getByTestId("status-skeleton")).toBeInTheDocument();
    expect(container.querySelector(".rounded-2xl")).not.toBeNull();
    expect(container.querySelectorAll(".bg-border\\/30").length).toBeGreaterThan(0);
  });

  it("renders the requested number of rows", () => {
    const { container } = render(<StatusSkeleton rows={5} />);
    expect(container.querySelectorAll(".animate-pulse-fast.flex")).toHaveLength(5);
  });

  it("defaults to 8 rows", () => {
    const { container } = render(<StatusSkeleton />);
    expect(container.querySelectorAll(".animate-pulse-fast.flex")).toHaveLength(8);
  });
});
