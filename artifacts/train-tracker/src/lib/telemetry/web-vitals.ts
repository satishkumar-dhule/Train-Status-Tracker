/**
 * Web Vitals (Core Web Vitals) -> OpenTelemetry metrics reporting.
 *
 * Metrics are recorded into OTel histograms lazily per report. If no
 * `MeterProvider` has been registered (e.g. the web SDK was not initialized),
 * `metrics.getMeter` returns a no-op meter and reports are dropped silently,
 * which is the desired failure mode for telemetry.
 */

import { metrics } from '@opentelemetry/api';
import type { Histogram } from '@opentelemetry/api';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import type { MetricType, ReportOpts } from 'web-vitals';

export const METER_NAME = 'train-tracker-web';

export type WebVitalName = 'lcp' | 'fcp' | 'ttfb' | 'inp' | 'cls';
export type WebVitalsReportFn = (vital: WebVitalName, value: number) => void;

export interface WebVitalsReportingOptions {
  /** Custom report sink; defaults to recording into the OTel histograms. */
  report?: WebVitalsReportFn;
}

/** Register one vital; matches the web-vitals v6 signatures (returns void). */
type VitalRegister = (
  onReport: (metric: MetricType) => void,
  opts?: ReportOpts,
) => void;

let reportHistogram: Histogram | undefined;
let clsHistogram: Histogram | undefined;

function getReportHistogram(): Histogram {
  if (reportHistogram === undefined) {
    reportHistogram = metrics
      .getMeter(METER_NAME)
      .createHistogram('web.vitals.report', {
        description: 'Web vital measurement in milliseconds',
        unit: 'ms',
      });
  }
  return reportHistogram;
}

function getClsHistogram(): Histogram {
  if (clsHistogram === undefined) {
    // CLS is a unitless delta (layout-shift score), so no unit is set.
    clsHistogram = metrics
      .getMeter(METER_NAME)
      .createHistogram('web.vitals.cls', {
        description: 'Cumulative layout shift score',
      });
  }
  return clsHistogram;
}

/** Default reporter: records a vital measurement into the OTel histograms. */
export function reportVitalToOtel(vital: WebVitalName, value: number): void {
  if (vital === 'cls') {
    getClsHistogram().record(value, { vital: 'cls' });
    return;
  }
  getReportHistogram().record(value, { vital });
}

/**
 * Starts reporting web vitals as OTel histograms.
 *
 * The `web-vitals` callbacks stay registered for the page lifetime; the
 * returned `stop()` function suppresses further reports. `onLCP` etc. are each
 * wrapped in try/catch so one broken registration cannot take down the others.
 * No-ops when not running in a browser with `PerformanceObserver` support.
 */
export function startWebVitalsReporting(
  options: WebVitalsReportingOptions = {},
): () => void {
  if (
    typeof window === 'undefined' ||
    typeof PerformanceObserver === 'undefined'
  ) {
    return () => {};
  }

  const report = options.report ?? reportVitalToOtel;
  let stopped = false;

  const handle = (vital: WebVitalName) => (metric: MetricType) => {
    if (stopped) return;
    report(vital, metric.value);
  };

  // reportAllChanges surfaces values synchronously for CLS/INP (and every
  // LCP update), which also makes them observable in tests.
  const registrations: Array<[VitalRegister, WebVitalName]> = [
    [onLCP, 'lcp'],
    [onFCP, 'fcp'],
    [onTTFB, 'ttfb'],
    [onINP, 'inp'],
    [onCLS, 'cls'],
  ];

  for (const [register, vital] of registrations) {
    try {
      register(handle(vital), { reportAllChanges: true });
    } catch {
      // Registration failed; keep going with the remaining vitals.
    }
  }

  return () => {
    stopped = true;
  };
}
