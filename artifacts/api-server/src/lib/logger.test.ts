import os from "node:os";
import { Writable } from "node:stream";
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import logger, {
  buildLoggerOptions,
  createRequestIdGenerator,
  createTraceMixin,
  logger as namedLogger,
  parseLogLevel,
} from "./logger";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function createCaptureStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines };
}

describe("parseLogLevel", () => {
  it("accepts every known pino level", () => {
    expect(parseLogLevel("fatal")).toBe("fatal");
    expect(parseLogLevel("error")).toBe("error");
    expect(parseLogLevel("warn")).toBe("warn");
    expect(parseLogLevel("info")).toBe("info");
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("trace")).toBe("trace");
    expect(parseLogLevel("silent")).toBe("silent");
  });

  it("falls back to info for invalid, empty, or missing values", () => {
    expect(parseLogLevel("verbose")).toBe("info");
    expect(parseLogLevel("")).toBe("info");
    expect(parseLogLevel(undefined)).toBe("info");
  });
});

describe("createTraceMixin", () => {
  it("returns {} when no span is active", () => {
    const mixin = createTraceMixin();
    expect(mixin({}, 30, logger)).toEqual({});
  });

  it("returns trace correlation fields for a valid active span context", () => {
    const spanContext = {
      traceId: "f".repeat(32),
      spanId: "e".repeat(16),
      traceFlags: 1,
    };
    const fakeSpan = { spanContext: () => spanContext } as unknown as Span;
    const activeContext = trace.setSpan(ROOT_CONTEXT, fakeSpan);
    const activeSpy = vi.spyOn(context, "active").mockReturnValue(activeContext);

    const result = createTraceMixin()({}, 30, logger);

    activeSpy.mockRestore();
    expect(result).toEqual({
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    });
  });

  it("returns {} when the active span context is invalid", () => {
    const spanContext = {
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 1,
    };
    const fakeSpan = { spanContext: () => spanContext } as unknown as Span;
    const activeContext = trace.setSpan(ROOT_CONTEXT, fakeSpan);
    const activeSpy = vi.spyOn(context, "active").mockReturnValue(activeContext);

    const result = createTraceMixin()({}, 30, logger);

    activeSpy.mockRestore();
    expect(result).toEqual({});
  });
});

describe("createRequestIdGenerator", () => {
  const gen = createRequestIdGenerator();

  it("reuses a well-formed x-request-id header", () => {
    expect(gen({ headers: { "x-request-id": "abc-123._ABC" } })).toBe(
      "abc-123._ABC",
    );
  });

  it("uses the first value when the header arrives as an array", () => {
    expect(
      gen({ headers: { "x-request-id": ["first-id", "second-id"] } }),
    ).toBe("first-id");
  });

  it("falls back to a UUID for malformed headers", () => {
    expect(gen({ headers: { "x-request-id": "bad id!" } })).toMatch(
      UUID_PATTERN,
    );
    expect(
      gen({ headers: { "x-request-id": "x".repeat(129) } }),
    ).toMatch(UUID_PATTERN);
  });

  it("falls back to a UUID when no header is present", () => {
    expect(gen({ headers: {} })).toMatch(UUID_PATTERN);
  });
});

describe("buildLoggerOptions", () => {
  it("defaults the level to info", () => {
    expect(buildLoggerOptions({}).level).toBe("info");
    expect(buildLoggerOptions({ LOG_LEVEL: "verbose" }).level).toBe("info");
    expect(buildLoggerOptions({ LOG_LEVEL: "debug" }).level).toBe("debug");
  });

  it("includes the service base fields and keeps pid/hostname", () => {
    const opts = buildLoggerOptions({});
    expect(opts.base?.service).toBe("train-tracker-api");
    expect(opts.base?.env).toBe("development");
    expect(opts.base?.pid).toBe(process.pid);
    expect(opts.base?.hostname).toBe(os.hostname());
    expect(opts.base?.version).toBeUndefined();
  });

  it("reads env and version from the environment", () => {
    const opts = buildLoggerOptions({
      NODE_ENV: "production",
      SERVICE_VERSION: "1.2.3",
    });
    expect(opts.base?.env).toBe("production");
    expect(opts.base?.version).toBe("1.2.3");
  });

  it("adds the sensitive-field redact paths", () => {
    const redact = buildLoggerOptions({}).redact ?? [];
    expect(redact).toContain("req.headers.authorization");
    expect(redact).toContain("req.headers.cookie");
    expect(redact).toContain("res.headers['set-cookie']");
    expect(redact).toContain("*.authorization");
    expect(redact).toContain("*.password");
    expect(redact).toContain("*.token");
    expect(redact).toContain("*.apiKey");
    expect(redact).toContain("*.secret");
  });

  it("uses pino-pretty outside production", () => {
    expect(buildLoggerOptions({}).transport).toBeDefined();
    expect(buildLoggerOptions({ NODE_ENV: "development" }).transport).toBeDefined();
  });

  it("drops pino-pretty in production unless forced", () => {
    expect(buildLoggerOptions({ NODE_ENV: "production" }).transport).toBeUndefined();
    expect(
      buildLoggerOptions({ NODE_ENV: "production", LOG_PRETTY: "true" })
        .transport,
    ).toBeDefined();
  });
});

describe("logger instance", () => {
  it("is silent under tests", () => {
    expect(logger.level).toBe("silent");
  });

  it("is the same instance as the default export", () => {
    expect(logger).toBe(namedLogger);
  });

  it("redacts sensitive values without throwing", () => {
    const { stream, lines } = createCaptureStream();
    const testLogger = pino(buildLoggerOptions({ NODE_ENV: "production" }), stream);

    testLogger.info({
      safe: "visible",
      req: {
        headers: {
          authorization: "Bearer secret-token",
          cookie: "sid=1",
          "set-cookie": "a=1",
        },
      },
      res: { headers: { "set-cookie": "b=2" } },
      user: {
        password: "hunter2pw",
        token: "secret-jwt",
        apiKey: "k-12345",
        secret: "top-secret",
      },
    });

    const line = lines.join("");
    expect(line).toContain("visible");
    expect(line).toContain("[Redacted]");
    expect(line).not.toContain("Bearer secret-token");
    expect(line).not.toContain("sid=1");
    expect(line).not.toContain("hunter2pw");
    expect(line).not.toContain("secret-jwt");
    expect(line).not.toContain("k-12345");
    expect(line).not.toContain("top-secret");
  });
});
