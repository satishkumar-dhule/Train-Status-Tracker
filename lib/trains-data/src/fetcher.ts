import { uniqueByNumber } from "./query";
import { searchTrains, TRAINS } from "./search";
import type { TrainEntry } from "./search";

/** Upstream source of the official NTES train list (train numbers + names). */
export const TRAIN_DATA_DEFAULT_URL =
  "https://enquiry.indianrail.gov.in/mntes/javascripts/train_data.js";

/** Cache-buster query parameter appended to the upstream URL (`?v=...`). */
export const TRAIN_DATA_VERSION_PARAM = "v";

/** How long a fetched train list is kept before it is re-pulled. Default: 2h. */
export const TRAIN_DATA_DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

/** Abort the upstream fetch if it has not completed within this window. */
export const TRAIN_DATA_DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum upstream redirects to follow before giving up. */
export const TRAIN_DATA_DEFAULT_MAX_REDIRECTS = 3;

/** Maximum number of response body bytes accepted from the upstream. */
export const TRAIN_DATA_DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface TrainDataFetcherOptions {
  /** Absolute URL of the NTES train list JS. Defaults to `TRAIN_DATA_DEFAULT_URL`. */
  baseUrl?: string;
  /**
   * Cache-buster value appended as `?v=<version>`. Changing it produces a new
   * source URL (and therefore a fresh fetch key), so callers can force a
   * re-pull without waiting for the TTL to expire.
   */
  version?: string;
  /** Time-to-live for the cached list in ms. Must be positive. Default: 2h. */
  ttlMs?: number;
  /** Abort the fetch after this many milliseconds. Must be positive. Default: 10s. */
  timeoutMs?: number;
  /** Maximum redirects followed (0 disables). Must be non-negative. Default: 3. */
  maxRedirects?: number;
  /** Reject response bodies larger than this many bytes. Must be positive. Default: 5 MiB. */
  maxResponseBytes?: number;
  /** Dataset used when the upstream fetch fails. Defaults to the bundled `TRAINS`. */
  fallback?: TrainEntry[];
  /** Injectable clock for tests. */
  now?: () => number;
  /** Injectable fetch implementation for tests / SSR. */
  fetchFn?: typeof fetch;
  /** Invoked when the upstream load fails and the fallback dataset is used. */
  onError?: (err: unknown) => void;
}

export interface TrainDataFetcher {
  /** The effective upstream URL, cache-buster applied. */
  readonly sourceUrl: string;
  /** The full train list (fetch + parse + TTL-cache, single-flight, fail-open). */
  getTrains(): Promise<TrainEntry[]>;
  /** Fuzzy duck-typed search over the fetched list. */
  search(query: string, limit?: number): Promise<TrainEntry[]>;
}

/**
 * Build the upstream URL with the cache-busting `v` query parameter.
 * When `version` is omitted the base URL is returned unchanged, so the value
 * embedded in `baseUrl` is honoured.
 */
export function buildTrainDataUrl(
  baseUrl: string = TRAIN_DATA_DEFAULT_URL,
  version?: string,
): string {
  if (!version) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set(TRAIN_DATA_VERSION_PARAM, version);
  return url.toString();
}

/**
 * Parse the raw NTES `train_data.js` payload (`var arrTrainList = ["00111- BIRD-SGTY RAPID CARGO", ...];`)
 * into `TrainEntry`s. Non-conforming entries are skipped; garbage returns [].
 */
export function parseTrainDataJs(raw: string): TrainEntry[] {
  const match = /arrTrainList\s*=\s*\[([\s\S]*)\]\s*;?\s*$/.exec(raw.trim());
  if (!match) return [];

  let entries: unknown;
  try {
    entries = JSON.parse(`[${match[1]}]`);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];

  const trains: TrainEntry[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const parsed = parseTrainListEntry(entry);
    if (parsed) trains.push(parsed);
  }
  return trains;
}

/** "00111- BIRD-SGTY RAPID CARGO" -> { number: "00111", name: "BIRD-SGTY RAPID CARGO" }. */
function parseTrainListEntry(raw: string): TrainEntry | null {
  const separator = raw.indexOf("- ");
  if (separator <= 0) return null;
  const number = raw.slice(0, separator).trim();
  const name = raw.slice(separator + 2).trim();
  if (!/^\d{5}$/.test(number) || name.length === 0) return null;
  return { number, name };
}

/**
 * Fetch a URL with hard bounds enforced, returning a plain `{ ok, status,
 * text }` result:
 *
 * - `timeoutMs`: the fetch is aborted (via `AbortController`) if it has not
 *   completed within the window.
 * - `maxRedirects`: redirects are walked manually (never auto-followed) and
 *   capped; a fresh request is issued per hop so an attacker cannot chain an
 *   unbounded redirect loop against us.
 * - `maxResponseBytes`: the body is streamed and rejected the moment it
 *   exceeds the cap, bounding memory use on oversized or hostile payloads.
 */
async function fetchHardened(
  url: string,
  options: {
    timeoutMs: number;
    maxRedirects: number;
    maxResponseBytes: number;
    fetchFn: typeof fetch;
  },
): Promise<{ ok: boolean; status: number; text: string }> {
  const { timeoutMs, maxRedirects, maxResponseBytes, fetchFn } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`train data fetch timed out after ${timeoutMs}ms`),
    );
  }, timeoutMs);

  try {
    let currentUrl = url;
    let redirects = 0;
    for (;;) {
      const response = await fetchFn(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || redirects >= maxRedirects) {
          throw new Error(
            `train data fetch exceeded the redirect limit of ${maxRedirects}`,
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirects += 1;
        continue;
      }

      const text = await readBodyLimited(response, maxResponseBytes);
      return { ok: response.ok, status: response.status, text };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body as UTF-8 text, failing once it exceeds `maxBytes`. */
async function readBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    return response.text();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(
        `train data response exceeded the ${maxBytes}-byte limit`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Fetch + parse + cache the NTES train list. Entries are cached for `ttlMs`
 * (default 2h); the in-flight promise is shared so concurrent callers trigger
 * a single upstream request. Failures are never cached and fall back to the
 * bundled dataset, so autocomplete still works when the upstream is down.
 */
export function createTrainDataFetcher(
  options: TrainDataFetcherOptions = {},
): TrainDataFetcher {
  const {
    baseUrl = TRAIN_DATA_DEFAULT_URL,
    version,
    ttlMs = TRAIN_DATA_DEFAULT_TTL_MS,
    timeoutMs = TRAIN_DATA_DEFAULT_TIMEOUT_MS,
    maxRedirects = TRAIN_DATA_DEFAULT_MAX_REDIRECTS,
    maxResponseBytes = TRAIN_DATA_DEFAULT_MAX_RESPONSE_BYTES,
    fallback = TRAINS,
    now = Date.now,
    fetchFn,
    onError,
  } = options;

  if (ttlMs <= 0) throw new Error("ttlMs must be positive");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error("maxRedirects must be a non-negative integer");
  }
  if (!Number.isFinite(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("maxResponseBytes must be a positive finite number");
  }

  const sourceUrl = buildTrainDataUrl(baseUrl, version);

  let cache: { trains: TrainEntry[]; expiresAt: number } | null = null;
  let inFlight: Promise<TrainEntry[]> | null = null;

  async function load(): Promise<TrainEntry[]> {
    if (cache && cache.expiresAt > now()) return cache.trains;
    if (!inFlight) {
      inFlight = (async () => {
        const startedAt = now();
        // Resolve `fetch` lazily so tests can stub `globalThis.fetch` after
        // this module has already been imported.
        const doFetch = fetchFn ?? globalThis.fetch;
        try {
          const response = await fetchHardened(sourceUrl, {
            timeoutMs,
            maxRedirects,
            maxResponseBytes,
            fetchFn: doFetch,
          });
          if (!response.ok) {
            throw new Error(
              `train data fetch failed with HTTP ${response.status}`,
            );
          }
          const trains = uniqueByNumber(parseTrainDataJs(response.text));
          if (trains.length === 0) {
            throw new Error("train data payload contained no valid entries");
          }
          cache = { trains, expiresAt: startedAt + ttlMs };
          return trains;
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  }

  async function getTrains(): Promise<TrainEntry[]> {
    try {
      return await load();
    } catch (err) {
      onError?.(err);
      return fallback;
    }
  }

  async function search(query: string, limit = 10): Promise<TrainEntry[]> {
    return searchTrains(query, limit, await getTrains());
  }

  return { sourceUrl, getTrains, search };
}
