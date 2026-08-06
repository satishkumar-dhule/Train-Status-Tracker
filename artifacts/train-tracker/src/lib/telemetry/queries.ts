/**
 * Business-event helpers that bridge @tanstack/react-query to OpenTelemetry.
 *
 * Kept dependency-free of the query client itself so tests can import the pure
 * helpers without booting react-query.
 */

import { context, trace, type Span } from '@opentelemetry/api';

/** OpenTelemetry tracer name for the web app's business spans. */
export const BUSINESS_TRACER_NAME = 'train-tracker-web';

/**
 * Extracts `train_number` / `departure_date` from a generated react-query key
 * like `[{ train_number: '22943', departure_date: '20260802' }, { exact: false }]`.
 * Returns an empty object when the key is not a status-lookup key.
 */
export function getTrainStatusQueryParams(queryKey: unknown): {
  train_number?: string;
  departure_date?: string;
} {
  if (!Array.isArray(queryKey)) return {};
  for (const part of queryKey) {
    if (part !== null && typeof part === 'object') {
      const record = part as Record<string, unknown>;
      if (
        typeof record.train_number === 'string' &&
        typeof record.departure_date === 'string'
      ) {
        return {
          train_number: record.train_number,
          departure_date: record.departure_date,
        };
      }
    }
  }
  return {};
}

/**
 * Starts (and returns, un-ended) a standalone business span. Deliberately not
 * context-activated: these are analytics spans and shouldn't become the parent
 * of unrelated work.
 */
export function startBusinessSpan(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
): Span {
  return trace
    .getTracer(BUSINESS_TRACER_NAME)
    .startSpan(name, { attributes });
}
