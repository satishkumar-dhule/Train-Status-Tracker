import { describe, expect, it, vi } from "vitest";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import {
  createEaseMyTripProvider,
  EaseMyTripProvider,
  mapEaseMyTripHtml,
  parseEaseMyTripHtml,
  toEaseMyTripDate,
} from "./easemytrip";

const KNOWN = { number: "12951", name: "Tejas Rajdhani Express" };

const stationBlock = (code: string, name: string, opts: {
  current?: boolean;
  km?: string;
  delay?: string;
  arrival?: string;
  departure?: string;
  platform?: string;
}) => `<div class="station-item ">
    <div class="station-item_inner">
        <div class="left-col">
            <div class="code">${code}</div>
            <div class="km">${opts.km ?? "0.0 Km"}</div>
        </div>
        <div class="line-col ${opts.current ? "arvd_sts_col" : " "}">
            <div class="dot ${opts.current ? "arvd_sts_col_dot blink blue" : ""}"></div>
        </div>
        <div class="right-col">
            <div class="${opts.current ? "arvd_sts_sec station-name" : "station-name"}">
                <a href="https://www.easemytrip.com/railways/x/">
                    <span>${name}</span>
                </a>
                <span>PF ${opts.platform ?? ""}</span>
            </div>
            <div class="delay">
                <span>${opts.delay ?? "On Time"}</span>
            </div>
            <div class="avl_times">
                <span>${opts.arrival ?? ""}</span>
            </div>
            <div class="dprt_times">
                <span>${opts.departure ?? ""}</span>
                <span class=""></span>
            </div>
        </div>
    </div>
</div>`;

const intermediateBlock = `<div class="station-item ">
    <div class="station-item_inner inner_station_btn_sec">
        <p class="inner_station_btn">17 Intermediate Stations</p>
    </div>
    <div id="intermediate_0" style="display:none;">
        <div class="station-item_inner inner_station_div">
            <div class="station-name">
                <span>Bby Mahalakshmi</span>
                <span>PF </span>
            </div>
            <div class="delay"><span>-</span></div>
            <div class="avl_times"><span>17:01</span></div>
            <div class="dprt_times"><span>17:01</span></div>
        </div>
    </div>
</div>`;

const headerBlock = `<div class="station-item station-item_top blu">
    <div class="station-item_inner">
        <div class="station-name">Stations</div>
    </div>
</div>
<div class="station-item date_label_prnt">
    <div class="station-item_inner ">Day 1</div>
</div>`;

const fixtureHtml = `<html><body>
    <h2 class="bs-pra mf16 mt10">
        12951 Tejas Rajdhani Running Status
    </h2>
    <p class="f11_ mt_10">
        <strong>Last Updated:</strong>
        10 minutes ago
    </p>
    ${headerBlock}
    ${stationBlock("MMCT", "Mumbai Central", {
      current: true,
      departure: "17:00",
    })}
    ${intermediateBlock}
    ${stationBlock("BVI", "Borivali", {
      km: "30.0 Km",
      arrival: "17:20",
      departure: "17:22",
      platform: "6",
    })}
    ${stationBlock("NDLS", "New Delhi", {
      km: "1384.0 Km",
      delay: "Late by 10 min",
      arrival: "08:32",
      platform: "3",
    })}
</body></html>`;

describe("toEaseMyTripDate", () => {
  it("converts YYYYMMDD to DD/MM/YYYY", () => {
    expect(toEaseMyTripDate("20260806")).toBe("06/08/2026");
  });

  it("returns null for a malformed date", () => {
    expect(toEaseMyTripDate("bogus")).toBeNull();
  });
});

describe("parseEaseMyTripHtml", () => {
  it("parses real stations and skips intermediate stations", () => {
    const parsed = parseEaseMyTripHtml(fixtureHtml);

    expect(parsed.titleTrainNumber).toBe("12951");
    expect(parsed.lastUpdated).toBe("10 minutes ago");
    expect(parsed.currentStationCode).toBe("MMCT");
    expect(parsed.rows.map((row) => row.station_code)).toEqual([
      "MMCT",
      "BVI",
      "NDLS",
    ]);

    const [mmct, bvi, ndls] = parsed.rows;
    expect(mmct).toMatchObject({
      station_code: "MMCT",
      station_name: "Mumbai Central",
      scheduled_departure: "17:00",
      scheduled_arrival: null,
      delay_minutes: 0,
      distance: 0,
      platform: null,
    });
    expect(bvi).toMatchObject({
      station_code: "BVI",
      station_name: "Borivali",
      scheduled_arrival: "17:20",
      scheduled_departure: "17:22",
      platform: "6",
      distance: 30,
      delay_minutes: 0,
    });
    expect(ndls).toMatchObject({
      station_code: "NDLS",
      station_name: "New Delhi",
      scheduled_arrival: "08:32",
      scheduled_departure: null,
      platform: "3",
      delay_minutes: 10,
    });
  });
});

describe("mapEaseMyTripHtml", () => {
  it("maps the page to a full status", () => {
    const status = mapEaseMyTripHtml(fixtureHtml, {
      trainNumber: "12951",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });

    expect(status.train_name).toBe("Tejas Rajdhani Express");
    expect(status.source_station_code).toBe("MMCT");
    expect(status.destination_station_code).toBe("NDLS");
    expect(status.current_station_code).toBe("MMCT");
    expect(status.current_station_name).toBe("Mumbai Central");
    expect(status.current_delay_minutes).toBe(0);
    expect(status.last_updated).toBe("10 minutes ago");
    expect(status.status_message).toBeNull();

    const [mmct, bvi] = status.stations;
    expect(mmct.is_current).toBe(true);
    expect(mmct.has_departed).toBe(false);
    expect(bvi.has_departed).toBe(false);
    expect(status.stations[2].has_departed).toBe(false);
  });

  it("reports not-found when the page does not name the train", () => {
    expect(() =>
      mapEaseMyTripHtml("<html><body><p>oops</p></body></html>", {
        trainNumber: "12951",
        departureDate: "20260806",
        knownTrain: KNOWN,
      }),
    ).toThrow(TrainStatusNotFoundError);
  });

  it("reports an upstream error when the title exists but no stations parse", () => {
    expect(() =>
      mapEaseMyTripHtml(
        "<h2>12951 Tejas Rajdhani Running Status</h2><p>layout changed</p>",
        { trainNumber: "12951", departureDate: "20260806", knownTrain: KNOWN },
      ),
    ).toThrow(TrainStatusUpstreamError);
  });
});

describe("EaseMyTripProvider", () => {
  it("builds the expected URL and returns mapped status", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(fixtureHtml, { status: 200 }),
    );
    const provider = new EaseMyTripProvider();

    const status = await provider.fetchTrainStatus("12951", "20260806", {
      fetchImpl,
    });

    expect(status.current_station_code).toBe("MMCT");
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin).toBe("https://www.easemytrip.com");
    expect(url.pathname).toBe("/railways/train-live-status-with-click");
    expect(url.searchParams.get("trainnumber")).toBe("12951");
    expect(url.searchParams.get("date")).toBe("06/08/2026");
  });

  it("returns the provider via the factory", () => {
    expect(createEaseMyTripProvider().name).toBe("easemytrip");
  });
});
