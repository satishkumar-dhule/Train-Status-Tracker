import os from "node:os";
import { randomUUID } from "node:crypto";
import { isSpanContextValid, context, trace } from "@opentelemetry/api";
import pino from "pino";
import type { Logger } from "pino";

/** Standard pino log levels plus the `silent` switch used to disable logging. */
export type PinoLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "silent";

/** Mixin signature matching pino's `mixin` option. */
export type PinoMixin = (mergeObject: object, level: number, logger: Logger) => object;

/** Header map shape exposed by Node's `IncomingMessage`. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

export interface LoggerConfig {
  /** Minimum log level to emit. */
  level: PinoLevel;
  /** Route logs through the pino-pretty transport. */
  pretty: boolean;
  /** pino redact paths (glob syntax) applied to every log record. */
  redact: readonly string[];
  /** Static base fields merged into every log record. */
  base: Record<string, unknown>;
  /** Service name reported in the base fields. */
  service: string;
}

const SERVICE_NAME = "train-tracker-api";
const DEFAULT_LEVEL: PinoLevel = "info";
const PINO_LEVELS: readonly string[] = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
];

const SENSITIVE_REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.authorization",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.secret",
  'req.headers["set-cookie"]',
];

const X_REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Validates a raw log level string against pino's known levels.
 * Invalid or missing values fall back to `info`.
 */
export function parseLogLevel(raw?: string): PinoLevel {
  if (typeof raw === "string" && PINO_LEVELS.includes(raw)) {
    return raw as PinoLevel;
  }
  return DEFAULT_LEVEL;
}

/**
 * Builds the static base fields for every log record while preserving pino's
 * default `pid` and `hostname`.
 */
function createBaseFields(
  env: Record<string, string | undefined>,
  service: string,
): Record<string, unknown> {
  return {
    pid: process.pid,
    hostname: os.hostname(),
    service,
    env: env.NODE_ENV ?? "development",
    ...(env.SERVICE_VERSION === undefined
      ? {}
      : { version: env.SERVICE_VERSION }),
  };
}

/**
 * Returns a pino mixin that correlates each log record with the active
 * OpenTelemetry span, adding `trace_id`, `span_id`, and `trace_flags` when a
 * valid span context is active and `{}` otherwise.
 */
export function createTraceMixin(): PinoMixin {
  return () => {
    const span = trace.getSpan(context.active());
    if (span === undefined) {
      return {};
    }
    const spanContext = span.spanContext();
    if (!isSpanContextValid(spanContext)) {
      return {};
    }
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    };
  };
}

/**
 * Builds pino logger options from environment variables. Pure with respect to
 * its `env` argument, so it is fully unit-testable.
 */
export function buildLoggerOptions(
  env: Record<string, string | undefined> = process.env,
): pino.LoggerOptions {
  const config: LoggerConfig = {
    level: parseLogLevel(env.LOG_LEVEL),
    pretty: env.NODE_ENV !== "production" || env.LOG_PRETTY === "true",
    redact: SENSITIVE_REDACT_PATHS,
    base: createBaseFields(env, SERVICE_NAME),
    service: SERVICE_NAME,
  };

  return {
    level: config.level,
    base: config.base,
    redact: [...config.redact],
    mixin: createTraceMixin(),
    ...(config.pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true },
          },
        }
      : {}),
  };
}

/**
 * Creates the `genReqId` handler for pino-http. Accepts a well-formed
 * `x-request-id` header, otherwise falls back to a random UUID.
 */
export function createRequestIdGenerator(): (req: {
  headers: RequestHeaders;
}) => string {
  return (req) => {
    const header = req.headers[X_REQUEST_ID_HEADER];
    const candidate = Array.isArray(header) ? header[0] : header;
    if (typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate)) {
      return candidate;
    }
    return randomUUID();
  };
}

export const logger = pino(buildLoggerOptions());

export default logger;
