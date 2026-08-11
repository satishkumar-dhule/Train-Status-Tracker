import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  context,
  metrics,
  trace,
  type Context,
  type ContextManager,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type SpanContext,
  type SpanOptions,
  type Tracer,
} from "@opentelemetry/api";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import { fetchProviderStatus } from "./http";
import type { MappedStatus } from "../train-status-mapper";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const mapped: MappedStatus = {
  train_number: "22943",
  train_name: "Train 22943",
  departure_date: "20260802",
  source_station_code: "ADI",
  source_station_name: "",
  destination_station_code: "NDLS",
  destination_station_name: "",
  current_station_code: null,
  current_station_name: null,
  current_delay_minutes: null,
  status_message: null,
  last_updated: null,
  provider: "",
  stations: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Synchronous, nesting stack context manager for asserting span activation. */
const ROOT_CONTEXT = context.active();
class StackContextManager implements ContextManager {
  private stack: Context[] = [];
  active(): Context {
    return this.stack[this.stack.length - 1] ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    this.stack.push(context);
    try {
      return fn.call(thisArg, ...args);
    } finally {
      this.stack.pop();
    }
  }
  bind<T>(_context: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    return this;
  }
}

class FakeSpan implements Span {
  readonly attributes: Record<string, unknown> = {};
  name: string;
  ended = false;
  status: { code: number; message?: string } = { code: 0 };

  constructor(
    name: string,
    readonly options?: SpanOptions,
  ) {
    this.name = name;
  }

  spanContext(): SpanContext {
    return {
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 1,
      isRemote: false,
    };
  }
  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }
  setAttributes(attributes: Record<string, unknown>): this {
    Object.assign(this.attributes, attributes);
    return this;
  }
  addLink(): this {
    return this;
  }
  addLinks(): this {
    return this;
  }
  addEvent(): this {
    return this;
  }
  setStatus(status: { code: number; message?: string }): this {
    this.status = status;
    return this;
  }
  updateName(name: string): this {
    this.name = name;
    return this;
  }
  end(): void {
    this.ended = true;
  }
  isRecording(): boolean {
    return true;
  }
  recordException(): void {}
}

const spanCalls: Array<{ name: string; span: FakeSpan }> = [];

type CounterCall = {
  name: string;
  value: number;
  attributes: Record<string, string | number>;
};
const counterAdds: CounterCall[] = [];

/**
 * Installs fake tracer/meter/context globals (once, at file scope) so the
 * module-level counter/histogram caches in `http.ts` are created against the
 * fakes on the very first call — the outer describe's plain runs included.
 */
function installFakeTelemetry(): void {
  context.setGlobalContextManager(new StackContextManager());
  const tracer = {
    startSpan: (name: string, options?: SpanOptions) => {
      const span = new FakeSpan(name, options);
      spanCalls.push({ name, span });
      return span;
    },
    startActiveSpan: () => {
      throw new Error("startActiveSpan is not exercised");
    },
  } as unknown as Tracer;
  trace.setGlobalTracerProvider({ getTracer: () => tracer });

  const meter = {
    createCounter: (name: string): Counter => ({
      add: (value: number, attributes?: Record<string, string | number>) => {
        counterAdds.push({ name, value, attributes: attributes ?? {} });
      },
    }),
    createHistogram: (name: string): Histogram => ({
      record: (value: number, attributes?: Record<string, string | number>) => {
        counterAdds.push({
          name: `${name}#hist`,
          value,
          attributes: attributes ?? {},
        });
      },
    }),
  } as Meter;
  metrics.setGlobalMeterProvider({
    getMeter: (): Meter => meter,
  });
}

installFakeTelemetry();

beforeEach(() => {
  spanCalls.length = 0;
  counterAdds.length = 0;
});

describe("fetchProviderStatus", () => {
  it("returns the mapped status on success", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const map = vi.fn(() => mapped);

    const result = await fetchProviderStatus(
      {
        provider: "test",
        url: "https://example.com/status?train_number=22943",
        responseType: "json",
        map,
      },
      { fetchImpl: fetchSpy },
    );

    expect(result).toBe(mapped);
    expect(map).toHaveBeenCalledWith({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the external abort signal through", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (
      _input: string | URL,
      init?: RequestInit,
    ) => {
      seenSignal = init?.signal ?? undefined;
      return jsonResponse({ ok: true });
    };

    await fetchProviderStatus(
      { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
      { fetchImpl, signal: controller.signal },
    );

    expect(seenSignal).toBeDefined();
    expect(seenSignal).not.toBe(controller.signal);
  });

  it("throws TrainStatusUpstreamError when fetch rejects", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(
      fetchProviderStatus(
        { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("throws TrainStatusUpstreamError on non-200 status", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("boom", { status: 500 });

    await expect(
      fetchProviderStatus(
        { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("throws TrainStatusUpstreamError on invalid JSON", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html>oops</html>", { status: 200 });

    await expect(
      fetchProviderStatus(
        { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("preserves a not-found thrown by the mapper", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});

    await expect(
      fetchProviderStatus(
        {
          provider: "test",
          url: "https://example.com",
          responseType: "json",
          map: () => {
            throw new TrainStatusNotFoundError("test", "nope");
          },
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusNotFoundError);
  });

  it("preserves an upstream error thrown by the mapper", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});

    await expect(
      fetchProviderStatus(
        {
          provider: "test",
          url: "https://example.com",
          responseType: "json",
          map: () => {
            throw new TrainStatusUpstreamError("test", "shape changed");
          },
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("wraps an unexpected mapper error as an upstream error", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});

    await expect(
      fetchProviderStatus(
        {
          provider: "test",
          url: "https://example.com",
          responseType: "json",
          map: () => {
            throw new Error("boom");
          },
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  describe("telemetry", () => {
    it("starts a client span with a redacted URL and provider attributes", async () => {
      await fetchProviderStatus(
        {
          provider: "test",
          url: "https://example.com/status?train_number=22943&departure_date=20260802",
          responseType: "json",
          map: () => mapped,
        },
        { fetchImpl: async () => jsonResponse({ ok: true }) },
      );

      const call = spanCalls.find((c) => c.name === "test.train_status.fetch");
      expect(call).toBeDefined();
      const attrs = call?.span.options?.attributes ?? {};
      // Query string (train_number/departure_date) is stripped for PII hygiene.
      expect(attrs["url.full"]).toBe("https://example.com/status");
      expect(attrs["http.request.method"]).toBe("GET");
      expect(attrs["provider.name"]).toBe("test");
      expect(attrs["server.address"]).toBe("example.com");
      expect(call?.span.ended).toBe(true);

      const recorded = counterAdds.find(
        (c) => c.name === "trains.status.upstream.requests",
      );
      expect(recorded).toEqual({
        name: "trains.status.upstream.requests",
        value: 1,
        attributes: { provider: "test", outcome: "success" },
      });
    });

    it("runs the fetch with the span active", async () => {
      let activeDuringFetch: Span | undefined;
      const fetchImpl: typeof fetch = async () => {
        activeDuringFetch = trace.getSpan(context.active());
        return jsonResponse({ ok: true });
      };

      await fetchProviderStatus(
        { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
        { fetchImpl },
      );

      const call = spanCalls.find((c) => c.name === "test.train_status.fetch");
      expect(activeDuringFetch).toBe(call?.span);
    });

    it("ends the span as failed with the classified outcome on error", async () => {
      await expect(
        fetchProviderStatus(
          {
            provider: "test",
            url: "https://example.com",
            responseType: "json",
            map: () => {
              throw new TrainStatusUpstreamError("test", "boom");
            },
          },
          { fetchImpl: async () => jsonResponse({ ok: true }) },
        ),
      ).rejects.toThrow(TrainStatusUpstreamError);

      const call = spanCalls.find((c) => c.name === "test.train_status.fetch");
      expect(call?.span.ended).toBe(true);
      const recorded = counterAdds.find(
        (c) => c.name === "trains.status.upstream.requests",
      );
      expect(recorded?.attributes).toEqual({
        provider: "test",
        outcome: "map_error",
      });
    });
  });
});
