import type { Express } from "express";

/** Lifecycle hooks for {@link startServer}, injectable for tests. */
export interface ServerHandlers {
  onListening(port: number): void;
  onError(err: unknown): void;
}

/**
 * Binds `app` to `port`. Node never passes an error to the `listen` callback
 * — bind failures (e.g. EADDRINUSE) surface as an `error` event on the server
 * — so the error is routed to `handlers.onError` where the process can decide
 * how to exit instead of crashing with an unhandled event.
 */
export function startServer(
  app: Express,
  port: number,
  handlers: ServerHandlers,
): ReturnType<Express["listen"]> {
  const server = app.listen(port);
  server.on("listening", () => handlers.onListening(port));
  server.on("error", (err) => handlers.onError(err));
  return server;
}
