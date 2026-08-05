import { describe, expect, it } from "vitest";
import {
  GetTrainRunsQueryParams,
  GetTrainStatusQueryParams,
  SearchTrainsQueryParams,
} from "./api";

describe("GetTrainStatusQueryParams", () => {
  it("accepts a 5-digit train number", () => {
    const parsed = GetTrainStatusQueryParams.safeParse({
      train_number: "22943",
      departure_date: "20260802",
    });
    expect(parsed.success).toBe(true);
  });

  it.each(["", "abc", "2294", "229430", "22943:20260802", "22 943", "\x1b]0;evil"])(
    "rejects a non-5-digit train number: %j",
    (train_number) => {
      const parsed = GetTrainStatusQueryParams.safeParse({
        train_number,
        departure_date: "20260802",
      });
      expect(parsed.success).toBe(false);
    },
  );

  it("rejects a train number that is not numeric", () => {
    const parsed = GetTrainStatusQueryParams.safeParse({
      train_number: "abcde",
      departure_date: "20260802",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("GetTrainRunsQueryParams", () => {
  it("accepts a 5-digit train number", () => {
    const parsed = GetTrainRunsQueryParams.safeParse({ train_number: "22943" });
    expect(parsed.success).toBe(true);
  });

  it.each(["abc", "2294", "229430", "22943:20260802"])(
    "rejects a non-5-digit train number: %j",
    (train_number) => {
      expect(GetTrainRunsQueryParams.safeParse({ train_number }).success).toBe(
        false,
      );
    },
  );
});

describe("SearchTrainsQueryParams", () => {
  it("accepts a short query", () => {
    const parsed = SearchTrainsQueryParams.safeParse({ q: "rajdhani" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an over-long query", () => {
    const parsed = SearchTrainsQueryParams.safeParse({ q: "x".repeat(65) });
    expect(parsed.success).toBe(false);
  });

  it("trims surrounding whitespace from the query", () => {
    const parsed = SearchTrainsQueryParams.safeParse({ q: "  rajdhani  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.q).toBe("rajdhani");
    }
  });
});
