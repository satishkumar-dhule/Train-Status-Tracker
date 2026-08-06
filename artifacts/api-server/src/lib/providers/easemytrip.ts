import type { MappedStatus } from "../train-status-mapper";
import { TrainStatusNotFoundError, TrainStatusUpstreamError } from "./errors";
import { fetchProviderStatus } from "./http";
import {
  assembleMappedStatus,
  type AssembleOptions,
  type ProviderStationRow,
} from "./normalize";
import type { KnownTrain, ProviderFetchOptions, TrainStatusProvider } from "./types";

const EASEMYTRIP_ENDPOINT =
  "https://www.easemytrip.com/railways/train-live-status-with-click";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
  Accept: "text/html,application/xhtml+xml",
};

/** YYYYMMDD -> DD/MM/YYYY, or null when not a valid 8-digit date. */
export function toEaseMyTripDate(departureDate: string): string | null {
  if (!/^\d{8}$/.test(departureDate)) return null;
  return `${departureDate.slice(6, 8)}/${departureDate.slice(4, 6)}/${departureDate.slice(0, 4)}`;
}

const STATION_BLOCK_OPEN = '<div class="station-item ">';
const CODE_RE = /<div class="code">([^<]*)<\/div>/;
const KM_RE = /<div class="km">([^<]*)<\/div>/;
const CURRENT_DOT_RE = /class="dot[^"]*blink blue/;
const STATION_NAME_RE = /<div class="[^"]*station-name[^"]*">([\s\S]*?)<\/div>/;
const STRONG_NAME_RE = /<strong>([^<]*)<\/strong>/;
const ANCHOR_NAME_RE = /<a[^>]*>\s*<span>([^<]*)<\/span>/;
const SPAN_NAME_RE = /<span>([^<]*)<\/span>/;
const PLATFORM_RE = /PF\s*([^<\s]*)</;
const DELAY_RE = /<div class="delay">([\s\S]*?)<\/div>/;
const ARRIVAL_RE = /<div class="avl_times">[\s\S]*?<span>([^<]*)<\/span>/;
const DEPARTURE_RE = /<div class="dprt_times">[\s\S]*?<span>([^<]*)<\/span>/;
const TITLE_RE = /<h2[^>]*>\s*(\d{4,5})\s+([\s\S]*?)Running Status/;
const LAST_UPDATED_RE = /<strong>Last Updated:<\/strong>\s*([\s\S]*?)<\/p>/;

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

interface ParsedStation {
  code: string;
  name: string;
  platform: string | null;
  delay_minutes: number | null;
  arrival: string | null;
  departure: string | null;
  distance: number | null;
  is_current: boolean;
}

function parseDelay(inner: string): number | null {
  if (/On Time/i.test(inner)) return 0;
  const late = /Late by\s*(\d+)\s*min/i.exec(inner);
  if (late) return Number(late[1]);
  const early = /Early by\s*(\d+)\s*min/i.exec(inner);
  if (early) return -Number(early[1]);
  return null;
}

function parseTime(inner: string | null): string | null {
  const time = inner?.trim() ?? "";
  return time === "" ? null : time;
}

function parseStationBlock(block: string): ParsedStation | null {
  const codeMatch = CODE_RE.exec(block);
  if (!codeMatch) return null;

  const nameMatch = STATION_NAME_RE.exec(block);
  let name = "";
  let platform: string | null = null;
  if (nameMatch) {
    const inner = nameMatch[1];
    name =
      STRONG_NAME_RE.exec(inner)?.[1] ??
      ANCHOR_NAME_RE.exec(inner)?.[1] ??
      SPAN_NAME_RE.exec(inner)?.[1] ??
      stripTags(inner);
    const pf = PLATFORM_RE.exec(inner);
    platform = pf && pf[1] ? pf[1].trim() : null;
  }

  const delayMatch = DELAY_RE.exec(block);
  const arrivalMatch = ARRIVAL_RE.exec(block);
  const departureMatch = DEPARTURE_RE.exec(block);
  const kmMatch = KM_RE.exec(block);
  const km = kmMatch ? Number(kmMatch[1].replace("Km", "").trim()) : NaN;

  return {
    code: codeMatch[1].trim(),
    name: name.trim(),
    platform,
    delay_minutes: delayMatch ? parseDelay(delayMatch[1]) : null,
    arrival: parseTime(arrivalMatch?.[1] ?? null),
    departure: parseTime(departureMatch?.[1] ?? null),
    distance: Number.isFinite(km) ? km : null,
    is_current: CURRENT_DOT_RE.test(block),
  };
}

/** Parse the EaseMyTrip running-status page into normalized rows. */
export function parseEaseMyTripHtml(html: string): {
  rows: ProviderStationRow[];
  currentStationCode: string | null;
  titleTrainNumber: string | null;
  lastUpdated: string | null;
} {
  const title = TITLE_RE.exec(html);
  const titleTrainNumber = title ? title[1] : null;

  const lastUpdatedMatch = LAST_UPDATED_RE.exec(html);
  const lastUpdated = lastUpdatedMatch
    ? stripTags(lastUpdatedMatch[1])
    : null;

  const blocks = html.split(STATION_BLOCK_OPEN);
  let currentStationCode: string | null = null;
  const rows: ProviderStationRow[] = [];
  for (const block of blocks) {
    const parsed = parseStationBlock(block);
    if (!parsed) continue;
    if (parsed.is_current) currentStationCode = parsed.code;
    rows.push({
      station_code: parsed.code,
      station_name: parsed.name,
      scheduled_arrival: parsed.arrival,
      actual_arrival: null,
      scheduled_departure: parsed.departure,
      actual_departure: null,
      delay_minutes: parsed.delay_minutes,
      distance: parsed.distance,
      platform: parsed.platform,
      halt_minutes: null,
      day: 1,
    });
  }

  return { rows, currentStationCode, titleTrainNumber, lastUpdated };
}

/** Map the EaseMyTrip page to a `MappedStatus`. */
export function mapEaseMyTripHtml(
  html: string,
  options: AssembleOptions,
): MappedStatus {
  const parsed = parseEaseMyTripHtml(html);

  if (parsed.rows.length === 0) {
    // A page that does not even name the requested train means "not found".
    // If the train name is present but no stations parsed, the layout likely
    // changed — surface as an upstream error rather than cache a false 404.
    if (parsed.titleTrainNumber === null) {
      throw new TrainStatusNotFoundError(
        "easemytrip",
        "Train not found or no data",
      );
    }
    throw new TrainStatusUpstreamError(
      "easemytrip",
      "No stations parsed from EaseMyTrip page",
    );
  }

  return assembleMappedStatus(parsed.rows, {
    ...options,
    currentStationCode: parsed.currentStationCode,
    statusMessage: null,
    lastUpdated: parsed.lastUpdated,
  });
}

export class EaseMyTripProvider implements TrainStatusProvider {
  readonly name = "easemytrip";
  readonly enabled = true;

  fetchTrainStatus(
    trainNumber: string,
    departureDate: string,
    options: ProviderFetchOptions,
    knownTrain: KnownTrain | null = null,
  ): Promise<MappedStatus> {
    const emtDate = toEaseMyTripDate(departureDate);
    if (!emtDate) {
      return Promise.reject(
        new TrainStatusNotFoundError(
          this.name,
          `Unsupported date format: ${departureDate}`,
        ),
      );
    }

    const url = new URL(EASEMYTRIP_ENDPOINT);
    url.searchParams.set("trainnumber", trainNumber);
    url.searchParams.set("date", emtDate);

    return fetchProviderStatus(
      {
        provider: this.name,
        url: url.toString(),
        responseType: "text",
        headers: HEADERS,
        map: (html) =>
          mapEaseMyTripHtml(String(html), {
            trainNumber,
            departureDate,
            knownTrain,
          }),
      },
      options,
    );
  }
}

export function createEaseMyTripProvider(): TrainStatusProvider {
  return new EaseMyTripProvider();
}
