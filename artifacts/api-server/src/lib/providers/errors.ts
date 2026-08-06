/**
 * Provider-agnostic error taxonomy for train status upstreams.
 *
 * The generic classes let the orchestrator and routes reason about failure
 * (not-found vs transient upstream error) without importing provider-specific
 * types. Every provider adapter wraps its own quirks into one of these.
 */
export class TrainStatusUpstreamError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TrainStatusUpstreamError";
  }
}

export class TrainStatusNotFoundError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TrainStatusNotFoundError";
  }
}
