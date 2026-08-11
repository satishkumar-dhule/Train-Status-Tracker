import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceNotes } from "./source-notes";

const base = {
  updatedLabel: "2 min ago",
  providerLabel: "NTES",
  refreshing: false,
  stale: false,
};

describe("SourceNotes", () => {
  it("renders the updated and provider parts with the correct testids", () => {
    render(<SourceNotes {...base} />);

    expect(screen.getByTestId("source-notes")).toBeInTheDocument();
    expect(screen.getByTestId("status-updated")).toHaveTextContent(
      "Updated 2 min ago",
    );
    expect(screen.getByTestId("status-provider")).toHaveTextContent(
      "via NTES",
    );
  });

  it("appends the Refreshing indicator and a polite live region when refreshing", () => {
    render(<SourceNotes {...base} refreshing />);

    expect(screen.getByTestId("status-refreshing")).toHaveTextContent(
      "Refreshing…",
    );
    expect(screen.getByTestId("source-notes")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("omits the Refreshing indicator and live region when not refreshing", () => {
    render(<SourceNotes {...base} />);

    expect(screen.queryByTestId("status-refreshing")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-notes")).not.toHaveAttribute(
      "aria-live",
    );
  });

  it("renders 'Status unavailable' when updatedLabel is null", () => {
    render(<SourceNotes {...base} updatedLabel={null} />);

    expect(screen.getByText("Status unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("status-updated")).not.toBeInTheDocument();
  });

  it("renders only the updated part when providerLabel is null", () => {
    render(<SourceNotes {...base} providerLabel={null} />);

    expect(screen.getByTestId("status-updated")).toHaveTextContent(
      "Updated 2 min ago",
    );
    expect(screen.queryByTestId("status-provider")).not.toBeInTheDocument();
  });

  it("shows the Stale pill and labels the wrapper when stale", () => {
    render(<SourceNotes {...base} stale />);

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByTestId("source-notes")).toHaveAttribute(
      "aria-label",
      "Status stale",
    );
  });

  it("omits the Stale pill and aria-label when not stale", () => {
    render(<SourceNotes {...base} />);

    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-notes")).not.toHaveAttribute(
      "aria-label",
    );
  });
});
