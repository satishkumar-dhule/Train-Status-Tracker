import { initTelemetry, shutdownTelemetry } from "./lib/telemetry";
import { shutdownRedis } from "./lib/redis-client";

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

await initTelemetry();
const { default: app } = await import("./app");
const { logger } = await import("./lib/logger");

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
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
