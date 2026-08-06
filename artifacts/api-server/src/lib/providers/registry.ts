import { createEaseMyTripProvider } from "./easemytrip";
import { createGoibiboProvider } from "./goibibo";
import { createPaytmProvider } from "./paytm";
import { createRailRadarProvider } from "./railradar";
import { createRailYatriProvider } from "./railyatri";
import type { TrainStatusProvider } from "./types";
import { createWhereIsMyTrainProvider } from "./whereismytrain";

/** Fallback provider order when `TRAIN_STATUS_PROVIDERS` is not set. */
export const DEFAULT_PROVIDER_ORDER = [
  "paytm",
  "goibibo",
  "railyatri",
  "whereismytrain",
  "easemytrip",
  "railradar",
] as const;

export type ProviderName = (typeof DEFAULT_PROVIDER_ORDER)[number];

function buildProvider(
  name: string,
  env: NodeJS.ProcessEnv,
): TrainStatusProvider | null {
  switch (name) {
    case "paytm":
      return createPaytmProvider();
    case "goibibo":
      return createGoibiboProvider();
    case "railyatri":
      return createRailYatriProvider();
    case "whereismytrain":
      return createWhereIsMyTrainProvider();
    case "easemytrip":
      return createEaseMyTripProvider();
    case "railradar":
      return createRailRadarProvider({ apiKey: env.RAILRADAR_API_KEY });
    default:
      return null;
  }
}

/**
 * Build the configured, enabled provider list in priority order. Unknown or
 * disabled (e.g. RailRadar without a key) providers are skipped silently.
 */
export function buildStatusProviders(
  env: NodeJS.ProcessEnv,
): TrainStatusProvider[] {
  const raw = (env.TRAIN_STATUS_PROVIDERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const order =
    raw.length > 0
      ? raw
      : (DEFAULT_PROVIDER_ORDER as readonly string[]);

  const seen = new Set<string>();
  const providers: TrainStatusProvider[] = [];
  for (const name of order) {
    if (seen.has(name)) continue;
    seen.add(name);
    const provider = buildProvider(name, env);
    if (provider?.enabled) providers.push(provider);
  }
  return providers;
}
