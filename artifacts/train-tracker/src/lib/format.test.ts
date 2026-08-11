import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDelayPhrase,
  formatDistance,
  formatDuration,
  formatLatency,
  formatRelativeTime,
  formatShortDate,
  formatStationName,
  formatStatusCode,
  formatUptime,
} from "./format";

describe("formatLatency", () => {
  it("formats sub-second latencies as whole milliseconds", () => {
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(12.4)).toBe("12 ms");
    expect(formatLatency(999)).toBe("999 ms");
  });

  it("switches to seconds at the 1000 ms boundary with one decimal", () => {
    expect(formatLatency(1_000)).toBe("1.0 s");
    expect(formatLatency(1_234)).toBe("1.2 s");
  });

  it("returns -- for null, negative, and non-finite input", () => {
    expect(formatLatency(null)).toBe("--");
    expect(formatLatency(-1)).toBe("--");
    expect(formatLatency(NaN)).toBe("--");
    expect(formatLatency(Infinity)).toBe("--");
  });
});

describe("formatBytes", () => {
  it("formats sub-kilobyte sizes as raw bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(892)).toBe("892 B");
    expect(formatBytes(1_023)).toBe("1023 B");
  });

  it("switches to KB at the 1024 boundary with one decimal", () => {
    expect(formatBytes(1_024)).toBe("1.0 KB");
    expect(formatBytes(65_536)).toBe("64.0 KB");
    expect(formatBytes(1_024 * 1_024 - 1)).toBe("1024.0 KB");
  });

  it("switches to MB beyond 1024 squared with one decimal", () => {
    expect(formatBytes(1_048_576)).toBe("1.0 MB");
    expect(formatBytes(1_500_000)).toBe("1.4 MB");
  });

  it("returns -- for null, negative, and non-finite input", () => {
    expect(formatBytes(null)).toBe("--");
    expect(formatBytes(-1)).toBe("--");
    expect(formatBytes(NaN)).toBe("--");
    expect(formatBytes(Infinity)).toBe("--");
  });
});

describe("formatUptime", () => {
  it("formats sub-minute uptimes as minutes and seconds", () => {
    expect(formatUptime(0)).toBe("0m 0s");
    expect(formatUptime(45)).toBe("0m 45s");
    expect(formatUptime(59)).toBe("0m 59s");
  });

  it("switches to hours at the 3600 s boundary", () => {
    expect(formatUptime(3_599)).toBe("59m 59s");
    expect(formatUptime(3_600)).toBe("1h 0m");
    expect(formatUptime(7_200)).toBe("2h 0m");
  });

  it("switches to days at the 86400 s boundary", () => {
    expect(formatUptime(86_399)).toBe("23h 59m");
    expect(formatUptime(86_400)).toBe("1d 0h");
    expect(formatUptime(86_400 * 3 + 3_600 * 4)).toBe("3d 4h");
  });

  it("returns -- for null, negative, and non-finite input", () => {
    expect(formatUptime(null)).toBe("--");
    expect(formatUptime(-1)).toBe("--");
    expect(formatUptime(NaN)).toBe("--");
  });
});

describe("formatStatusCode", () => {
  it("renders the raw status code", () => {
    expect(formatStatusCode(200)).toBe("200");
    expect(formatStatusCode(404)).toBe("404");
  });

  it("renders ERR when no response arrived", () => {
    expect(formatStatusCode(null)).toBe("ERR");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("clamps to just now within 5 seconds", () => {
    expect(formatRelativeTime(now, now)).toBe("just now");
    expect(formatRelativeTime(now - 4_000, now)).toBe("just now");
  });

  it("formats seconds ago from 5s up to just under a minute", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("5s ago");
    expect(formatRelativeTime(now - 12_000, now)).toBe("12s ago");
    expect(formatRelativeTime(now - 59_000, now)).toBe("59s ago");
  });

  it("formats minutes ago from one minute up to just under an hour", () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe("1m ago");
    expect(formatRelativeTime(now - 180_000, now)).toBe("3m ago");
    expect(formatRelativeTime(now - 3_599_000, now)).toBe("59m ago");
  });

  it("formats hours ago beyond one hour", () => {
    expect(formatRelativeTime(now - 3_600_000, now)).toBe("1h ago");
    expect(formatRelativeTime(now - 86_400_000, now)).toBe("24h ago");
  });

  it("clamps a future timestamp to just now", () => {
    expect(formatRelativeTime(now + 5_000, now)).toBe("just now");
  });
});

describe("formatDuration", () => {
  it("delegates to trains-data for valid totals", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(480)).toBe("8h");
    expect(formatDuration(510)).toBe("8h 30m");
  });

  it("returns -- for null, negative, and non-finite input", () => {
    expect(formatDuration(null)).toBe("--");
    expect(formatDuration(-5)).toBe("--");
    expect(formatDuration(NaN)).toBe("--");
    expect(formatDuration(Infinity)).toBe("--");
  });
});

describe("formatShortDate", () => {
  it("wraps trains-data's short date formatting", () => {
    expect(formatShortDate("2026-08-02")).toBe("2 Aug");
    expect(formatShortDate("2026-12-01")).toBe("1 Dec");
  });

  it("passes malformed input through unchanged", () => {
    expect(formatShortDate("nonsense")).toBe("nonsense");
  });
});

describe("formatStationName", () => {
  it("uppercases a station code for display", () => {
    expect(formatStationName("indb")).toBe("INDB");
    expect(formatStationName("ujn")).toBe("UJN");
    expect(formatStationName("BPL")).toBe("BPL");
  });
});

describe("formatDelayPhrase", () => {
  it("says on time for null and zero", () => {
    expect(formatDelayPhrase(null)).toBe("On time");
    expect(formatDelayPhrase(0)).toBe("On time");
  });

  it("reports minutes late for positive delays", () => {
    expect(formatDelayPhrase(45)).toBe("45 min late");
    expect(formatDelayPhrase(1)).toBe("1 min late");
  });

  it("reports minutes early for negative delays using the absolute value", () => {
    expect(formatDelayPhrase(-45)).toBe("45 min early");
    expect(formatDelayPhrase(-1)).toBe("1 min early");
  });
});

describe("formatDistance", () => {
  it("renders an em dash for a missing distance", () => {
    expect(formatDistance(null)).toBe("—");
  });

  it("renders sub-kilometre distances in metres", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(0.5)).toBe("500 m");
    expect(formatDistance(0.999)).toBe("999 m");
  });

  it("rounds kilometre distances", () => {
    expect(formatDistance(1)).toBe("1 km");
    expect(formatDistance(1.4)).toBe("1 km");
    expect(formatDistance(12.6)).toBe("13 km");
  });
});
