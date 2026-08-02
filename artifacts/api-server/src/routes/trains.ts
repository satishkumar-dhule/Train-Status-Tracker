import { Router, type IRouter } from "express";
import {
  GetTrainStatusQueryParams,
  GetTrainStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const PAYTM_BASE = "https://travel.paytm.com/api/trains/v1/train/status";

/** Parse "HH:MM" time and return total minutes since midnight, or null */
function toMinutes(t: string | undefined | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/** Return signed delay (actual - scheduled) in minutes, accounting for day roll-overs */
function calcDelay(
  scheduled: string | undefined | null,
  actual: string | undefined | null,
): number | null {
  const s = toMinutes(scheduled);
  const a = toMinutes(actual);
  if (s === null || a === null) return null;
  let diff = a - s;
  // correct for midnight crossings (e.g. scheduled 23:50, actual 00:10 → +20 min)
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

/** Strip HTML tags from a string */
function stripHtml(s: string | undefined | null): string | null {
  if (!s) return null;
  return s.replace(/<[^>]+>/g, "").trim() || null;
}

router.get("/trains/status", async (req, res): Promise<void> => {
  const parsed = GetTrainStatusQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { train_number, departure_date } = parsed.data;

  const upstreamUrl = new URL(PAYTM_BASE);
  upstreamUrl.searchParams.set("train_number", train_number);
  upstreamUrl.searchParams.set("departure_date", departure_date);
  upstreamUrl.searchParams.set("isH5", "true");
  upstreamUrl.searchParams.set("client", "web");
  upstreamUrl.searchParams.set(
    "deviceIdentifier",
    "Mozilla Firefox-150.0.0.0",
  );

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    req.log.error({ err }, "Upstream fetch failed");
    res.status(502).json({ error: "Could not reach train data provider" });
    return;
  }

  if (!upstream.ok) {
    req.log.warn({ status: upstream.status }, "Upstream returned non-200");
    res.status(502).json({ error: "Train data provider returned an error" });
    return;
  }

  let raw: unknown;
  try {
    raw = await upstream.json();
  } catch {
    res.status(502).json({ error: "Invalid response from train data provider" });
    return;
  }

  // Type-narrow the Paytm response
  if (
    !raw ||
    typeof raw !== "object" ||
    !("body" in raw) ||
    !raw.body ||
    typeof raw.body !== "object"
  ) {
    req.log.warn({ raw }, "Unexpected upstream response shape");
    res.status(502).json({ error: "Unexpected response from data provider" });
    return;
  }

  const body = raw.body as Record<string, unknown>;

  // Check for error from upstream
  if ("error" in raw && raw.error) {
    const status = "status" in raw ? (raw.status as Record<string, unknown>) : {};
    const result = typeof status === "object" && status && "result" in status
      ? String(status.result)
      : "";
    if (result !== "success") {
      res.status(404).json({ error: "Train not found or no data available" });
      return;
    }
  }

  const rawStations = Array.isArray(body.stations) ? body.stations : [];
  const currentStationCode =
    typeof body.current_station === "string" ? body.current_station : null;

  // Find current station serial number for has_departed calculation
  const currentSerial = rawStations.reduce((acc: number, s: unknown) => {
    if (
      s &&
      typeof s === "object" &&
      "stationCode" in s &&
      (s as Record<string, unknown>).stationCode === currentStationCode &&
      "stnSerialNumber" in s
    ) {
      return parseInt(String((s as Record<string, unknown>).stnSerialNumber), 10);
    }
    return acc;
  }, 0);

  const stations = rawStations.map((s: unknown) => {
    const st = s as Record<string, unknown>;
    const serial = parseInt(String(st.stnSerialNumber ?? "0"), 10);
    const isCurrent = st.stationCode === currentStationCode;
    const hasDeparted = serial < currentSerial || (isCurrent && !!st.actual_departure_time);

    const scheduledArrival =
      st.arrivalTime && st.dayCount
        ? String(st.arrivalTime)
        : null;
    const scheduledDeparture =
      st.departureTime && st.dayCount
        ? String(st.departureTime)
        : null;
    const actualArrival =
      typeof st.actual_arrival_time === "string" ? st.actual_arrival_time : null;
    const actualDeparture =
      typeof st.actual_departure_time === "string" ? st.actual_departure_time : null;

    const delayMinutes = calcDelay(scheduledArrival, actualArrival);

    return {
      station_code: String(st.stationCode ?? ""),
      station_name: String(st.stationName ?? ""),
      scheduled_arrival: scheduledArrival,
      actual_arrival: actualArrival,
      scheduled_departure: scheduledDeparture,
      actual_departure: actualDeparture,
      delay_minutes: delayMinutes,
      distance_from_source:
        st.distance !== undefined ? Number(st.distance) : null,
      platform:
        st.expected_platform !== undefined
          ? String(st.expected_platform)
          : null,
      halt_minutes:
        typeof st.haltTime === "number" ? st.haltTime : null,
      has_departed: hasDeparted,
      is_current: isCurrent,
      day: parseInt(String(st.dayCount ?? "1"), 10),
    };
  });

  const firstStation = stations[0];
  const lastStation = stations[stations.length - 1];

  // Derive current delay from current station
  const currentStationData = stations.find((st) => st.is_current);
  const currentDelay = currentStationData?.delay_minutes ?? null;

  const response = GetTrainStatusResponse.parse({
    train_number: train_number,
    train_name: `Train ${train_number}`,
    departure_date: String(departure_date),
    source_station_code: firstStation?.station_code ?? "",
    source_station_name: firstStation?.station_name ?? "",
    destination_station_code: lastStation?.station_code ?? "",
    destination_station_name: lastStation?.station_name ?? "",
    current_station_code: currentStationCode,
    current_station_name:
      currentStationData?.station_name ?? null,
    current_delay_minutes: currentDelay,
    status_message: stripHtml(
      typeof body.train_status_message === "string"
        ? body.train_status_message
        : null,
    ),
    last_updated:
      typeof body.server_timestamp === "string" ? body.server_timestamp : null,
    stations,
  });

  res.json(response);
});

export default router;
