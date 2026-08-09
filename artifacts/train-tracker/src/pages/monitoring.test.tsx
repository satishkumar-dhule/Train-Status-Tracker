import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { summarizeProbes } from "../lib/api-monitoring";
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
    summary: summarizeProbes([]),
    history: {
      health: [],
      catalog: [],
      search: [],
      runs: [],
      status: [],
      providers: [],
    },
    isPolling: false,
    isPaused: false,
    hasEverRun: true,
    togglePaused: vi.fn(),
    refresh: vi.fn(),
  };
}

function renderMonitoring() {
  const memory = memoryLocation({ path: "/monitoring" });
  return render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <Monitoring />
    </Router>,
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
