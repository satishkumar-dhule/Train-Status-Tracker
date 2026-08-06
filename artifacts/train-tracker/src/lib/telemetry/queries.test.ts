import { afterEach, describe, expect, it, vi } from "vitest";
import {
  trace,
  type SpanContext,
  type SpanOptions,
  type Tracer,
} from "@opentelemetry/api";
import {
  getTrainStatusQueryParams,
  startBusinessSpan,
  BUSINESS_TRACER_NAME,
} from "./queries";

const spanStarts: Array<{ name: string; options?: SpanOptions }> = [];

class FakeSpan {
  constructor(
    readonly name: string,
    readonly options?: SpanOptions,
  ) {}

  spanContext(): SpanContext {
    return {
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 1,
      isRemote: false,
    };
  }
  end(): void {}
  isRecording(): boolean {
    return true;
  }
  recordException(): void {}
  setStatus(): this {
    return this;
  }
  setAttribute(): this {
    return this;
  }
  setAttributes(): this {
    return this;
  }
  addEvent(): this {
    return this;
  }
  updateName(): this {
    return this;
  }
}

afterEach(() => {
  spanStarts.length = 0;
  trace.disable();
});

describe("getTrainStatusQueryParams", () => {
  it("extracts train_number and departure_date from a react-query key", () => {
    const params = getTrainStatusQueryParams([
      { train_number: "22943", departure_date: "20260802" },
      { exact: false },
    ]);
    expect(params).toEqual({
      train_number: "22943",
      departure_date: "20260802",
    });
  });

  it("returns an empty object for a non-status key", () => {
    expect(getTrainStatusQueryParams(["trainSearch", "raj"])).toEqual({});
  });

  it("returns an empty object for a key missing the date", () => {
    expect(getTrainStatusQueryParams([{ train_number: "22943" }])).toEqual({});
  });

  it("tolerates non-array query keys", () => {
    expect(getTrainStatusQueryParams(undefined)).toEqual({});
    expect(getTrainStatusQueryParams("train_status")).toEqual({});
  });
});

describe("startBusinessSpan", () => {
  it("starts a business span with the given name and attributes", () => {
    trace.setGlobalTracerProvider({
      getTracer: () =>
        ({
          startSpan: (name: string, options?: SpanOptions) => {
            spanStarts.push({ name, options });
            return new FakeSpan(name, options);
          },
        }) as Tracer,
    });

    const span = startBusinessSpan("train_status.lookup", {
      "train.number": "22943",
      "query.success": true,
    });

    expect(spanStarts).toHaveLength(1);
    expect(spanStarts[0].name).toBe("train_status.lookup");
    expect(spanStarts[0].options?.attributes).toEqual({
      "train.number": "22943",
      "query.success": true,
    });
  });

  it("uses the business tracer name", () => {
    const getTracer = vi.fn().mockReturnValue({
      startSpan: (name: string, options?: SpanOptions) =>
        new FakeSpan(name, options),
    });
    trace.setGlobalTracerProvider({
      getTracer,
    });

    startBusinessSpan("train_status.lookup", {});
    expect(getTracer.mock.calls[0]?.[0]).toBe(BUSINESS_TRACER_NAME);
  });
});
