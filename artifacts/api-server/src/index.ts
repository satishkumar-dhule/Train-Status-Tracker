import { initTelemetry, shutdownTelemetry } from "./lib/telemetry";
import { shutdownRedis } from "./lib/redis-client";
import { logger } from "./lib/logger";
import { startServer } from "./server";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  await initTelemetry();
} catch (err) {
  logger.error({ err }, "Telemetry init failed; continuing without it");
}

const { default: app } = await import("./app");

const server = startServer(app, port, {
  onListening: () =>
    logger.info(
      {
        port,
        env: process.env.NODE_ENV ?? "development",
        version: process.env.SERVICE_VERSION ?? null,
      },
      "Server listening",
    ),
  onError: (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  },
});

if (process.env.NODE_ENV !== "test") {
  /** Max time to drain in-flight requests before forcing the exit. */
  const DRAIN_TIMEOUT_MS = 10_000;

  /**
   * Stops accepting new connections, waits for in-flight requests to drain,
   * then flushes telemetry and Redis before exiting. Bounded by
   * {@link DRAIN_TIMEOUT_MS} so a hung peer cannot stall shutdown forever.
   */
  const beginShutdown = async (signal: string, exitCode = 0) => {
    logger.info({ signal }, "Shutting down");
    const drain = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DRAIN_TIMEOUT_MS);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await drain;
    try {
      await shutdownTelemetry();
    } catch (err) {
      logger.error({ err }, "Error during telemetry shutdown");
    }
    try {
      await shutdownRedis();
    } catch (err) {
      logger.error({ err }, "Error during Redis shutdown");
    }
    process.exit(exitCode);
  };

  process.on("SIGTERM", () => void beginShutdown("SIGTERM"));
  process.on("SIGINT", () => void beginShutdown("SIGINT"));

  // The last line of defense: log the failure, then run the same graceful
  // shutdown so buffered telemetry/log lines are not lost, exiting non-zero.
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    void beginShutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection");
    void beginShutdown("unhandledRejection", 1);
  });
}
