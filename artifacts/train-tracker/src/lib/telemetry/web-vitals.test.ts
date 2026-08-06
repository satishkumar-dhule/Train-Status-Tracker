import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metrics, type Histogram, type Meter } from "@opentelemetry/api";

const { callbacks, optionsSeen } = vi.hoisted(() => ({
  callbacks: {} as Record<string, (metric: { value: number }) => void>,
  optionsSeen: {} as Record<string, unknown>,
}));

const histogramRecords: Array<{
  name: string;
  value: number;
  attributes: Record<string, string | number>;
}> = [];
metrics.setGlobalMeterProvider({
  getMeter: (): Meter =>
    ({
      createHistogram: (name: string): Histogram => ({
        record: (value: number, attributes?: Record<string, string | number>) => {
          histogramRecords.push({ name, value, attributes: attributes ?? {} });
        },
      }),
      createCounter: () => {
        throw new Error("createCounter not expected");
      },
    }) as Meter,
});

vi.mock("web-vitals", () => {
  const register =
    (vital: string) =>
    (onReport: (metric: { value: number }) => void, opts?: unknown): void => {
      callbacks[vital] = onReport;
      optionsSeen[vital] = opts;
    };
  return {
    onCLS: register("cls"),
    onFCP: register("fcp"),
    onINP: register("inp"),
    onLCP: register("lcp"),
    onTTFB: register("ttfb"),
  };
});

import {
  METER_NAME,
  reportVitalToOtel,
  startWebVitalsReporting,
  type WebVitalsReportFn,
} from "./web-vitals";

describe("startWebVitalsReporting", () => {
  beforeEach(() => {
    Object.keys(callbacks).forEach((key) => delete callbacks[key]);
    Object.keys(optionsSeen).forEach((key) => delete optionsSeen[key]);
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        observe(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    histogramRecords.length = 0;
  });

  it("registers every core web vital", () => {
    const stop = startWebVitalsReporting();
    for (const vital of ["lcp", "fcp", "ttfb", "inp", "cls"]) {
      expect(typeof callbacks[vital], `missing callback for ${vital}`).toBe(
        "function",
      );
    }
    stop();
  });

  it("registers each vital with reportAllChanges", () => {
    const stop = startWebVitalsReporting();
    for (const vital of ["lcp", "fcp", "ttfb", "inp", "cls"]) {
      expect(optionsSeen[vital]).toEqual({ reportAllChanges: true });
    }
    stop();
  });

  it("reports vital measurements through the injected reporter", () => {
    const reports: Array<[string, number]> = [];
    const report: WebVitalsReportFn = (vital, value) =>
      reports.push([vital, value]);

    const stop = startWebVitalsReporting({ report });
    callbacks["lcp"]?.({ value: 2500 });
    callbacks["cls"]?.({ value: 0.05 });
    callbacks["inp"]?.({ value: 180 });

    expect(reports).toEqual([
      ["lcp", 2500],
      ["cls", 0.05],
      ["inp", 180],
    ]);
    stop();
  });

  it("stops reporting after stop() is called", () => {
    const reports: Array<[string, number]> = [];
    const report: WebVitalsReportFn = (vital, value) =>
      reports.push([vital, value]);

    const stop = startWebVitalsReporting({ report });
    stop();
    callbacks["lcp"]?.({ value: 2500 });

    expect(reports).toEqual([]);
  });

  it("is a no-op without PerformanceObserver support", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const stop = startWebVitalsReporting();
    expect(Object.keys(callbacks).length).toBe(0);
    stop();
  });
});

describe("reportVitalToOtel", () => {
  it("records into the (no-op) meter without throwing", () => {
    expect(METER_NAME).toBe("train-tracker-web");
    expect(() => {
      reportVitalToOtel("lcp", 2500);
      reportVitalToOtel("cls", 0.05);
      reportVitalToOtel("ttfb", 800);
    }).not.toThrow();
  });

  it("records lcp into the web.vitals.report histogram with the vital attribute", () => {
    reportVitalToOtel("lcp", 2500);

    expect(histogramRecords).toContainEqual({
      name: "web.vitals.report",
      value: 2500,
      attributes: { vital: "lcp" },
    });
  });

  it("records cls into the web.vitals.cls histogram with the vital attribute", () => {
    reportVitalToOtel("cls", 0.05);

    expect(histogramRecords).toContainEqual({
      name: "web.vitals.cls",
      value: 0.05,
      attributes: { vital: "cls" },
    });
  });
});
