import type { MappedStatus } from "../train-status-mapper";

/**
 * Transport options passed through to providers. Kept identical to the legacy
 * Paytm client's `PaytmFetchOptions` so tests can stub `fetchImpl` and callers
 * can abort in-flight requests.
 */
export interface ProviderFetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Context needed to render a human-readable train name on unknown trains. */
export interface KnownTrain {
  number: string;
  name: string;
}

/**
 * A train status upstream. Each adapter is a "deep module": it owns its
 * endpoint, request encoding, authentication, date format and payload
 * parsing, and only exposes this small surface.
 */
export interface TrainStatusProvider {
  readonly name: string;
  /** Whether this provider may be used in the current environment. */
  readonly enabled: boolean;
  fetchTrainStatus(
    trainNumber: string,
    departureDate: string,
    options: ProviderFetchOptions,
    knownTrain: KnownTrain | null,
  ): Promise<MappedStatus>;
}
