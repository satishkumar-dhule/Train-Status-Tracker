import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "wouter";
import type { MonitoringResult } from "../hooks/use-api-monitoring";
import Monitoring from "./Monitoring";

const mocks = vi.hoisted(() => ({
  useApiMonitoring: vi.fn(),
  monitoringView: vi.fn(),
}));

vi.mock("../hooks/use-api-monitoring", () => ({
  useApiMonitoring: mocks.useApiMonitoring,
}));

vi.mock("../components/monitoring-view", () => ({
  MonitoringView: mocks.monitoringView,
}));

function makeResult(): MonitoringResult {
  return {
    snapshot: null,
    summary: null,
    history: [],
    isPolling: false,
    isPaused: false,
    hasEverRun: true,
    togglePaused: vi.fn(),
    refresh: vi.fn(),
  };
}

function renderMonitoring() {
  return render(
    <MemoryRouter initialPath="/monitoring">
      <Monitoring />
    </MemoryRouter>,
  );
}

describe("Monitoring", () => {
  beforeEach(() => {
    mocks.useApiMonitoring.mockReset();
    mocks.monitoringView.mockReset();
    mocks.monitoringView.mockImplementation(() => (
      <div data-testid="monitoring-view-mock" />
    ));
    mocks.useApiMonitoring.mockReturnValue(makeResult());
    document.documentElement.classList.remove("inverted");
  });

  it("renders the page shell: title, back link, and invert toggle", () => {
    renderMonitoring();

    expect(screen.getByText("API Monitor")).toBeInTheDocument();
    expect(screen.getByTestId("monitoring-back")).toHaveAttribute("href", "/");
    expect(screen.getByTestId("button-invert")).toBeInTheDocument();
    expect(screen.getByTestId("monitoring-view-mock")).toBeInTheDocument();
  });

  it("renders MonitoringView with the hook result", () => {
    const result = makeResult();
    mocks.useApiMonitoring.mockReturnValue(result);
    renderMonitoring();

    expect(mocks.useApiMonitoring).toHaveBeenCalledTimes(1);
    expect(mocks.monitoringView.mock.calls[0]?.[0]).toEqual({ result });
  });
});
