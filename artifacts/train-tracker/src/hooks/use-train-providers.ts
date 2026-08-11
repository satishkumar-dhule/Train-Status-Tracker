import { useEffect, useState } from "react";

/**
 * The ops endpoint that reports per-provider QoS; not part of the generated
 * client, so it is fetched directly.
 */
const PROVIDERS_PATH = "/api/trains/providers";

export interface TrainProvidersState {
  /** Enabled train status gateways ("providers") reported by the API. */
  gateways: string[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * The list of enabled train-status gateways, used to populate the gateway
 * selector. Fail-closed: when the API is unreachable the list is empty so the
 * UI falls back to auto (failover) rather than offering a broken pin.
 */
export function useTrainProviders(): TrainProvidersState {
  const [state, setState] = useState<TrainProvidersState>({
    gateways: [],
    isLoading: true,
    isError: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(PROVIDERS_PATH, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{
          providers?: Array<{ name?: unknown }>;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        const gateways = (data.providers ?? [])
          .map((provider) => provider.name)
          .filter((name): name is string => typeof name === "string" && name !== "");
        setState({ gateways, isLoading: false, isError: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ gateways: [], isLoading: false, isError: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
