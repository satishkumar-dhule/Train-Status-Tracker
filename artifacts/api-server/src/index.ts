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

startServer(app, port, {
  onListening: () => logger.info({ port }, "Server listening"),
  onError: (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  },
});

if (process.env.NODE_ENV !== "test") {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    await shutdownTelemetry();
    await shutdownRedis();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
