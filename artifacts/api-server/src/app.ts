import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { createRequestIdGenerator, logger } from "./lib/logger";
import { redactUrl } from "./lib/trace-attributes";

type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  code?: unknown;
  statusCode?: unknown;
  cause?: { name: string; message: string };
};

/**
 * Safely extracts loggable fields from an unknown error value, avoiding any
 * function or object leakage. Includes the immediate `cause` at depth 1.
 */
function serializeError(err: unknown): SerializedError | undefined {
  if (err === null || typeof err !== "object") {
    return undefined;
  }
  const record = err as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "Error";
  const message =
    typeof record.message === "string" ? record.message : "Unknown error";

  const result: SerializedError = { name, message };
  if (typeof record.stack === "string") {
    result.stack = record.stack;
  }
  if (record.code !== undefined) {
    result.code = record.code;
  }
  if (record.statusCode !== undefined) {
    result.statusCode = record.statusCode;
  }
  if (record.cause !== null && typeof record.cause === "object") {
    const cause = record.cause as Record<string, unknown>;
    const causeMessage =
      typeof cause.message === "string" ? cause.message : undefined;
    if (causeMessage !== undefined) {
      result.cause = {
        name: typeof cause.name === "string" ? cause.name : "Error",
        message: causeMessage,
      };
    }
  }
  return result;
}

/**
 * Builds the CORS policy. Cross-origin access is open in non-production
 * environments (local development); in production only origins listed in
 * `CORS_ORIGIN` (a comma-separated env value) are reflected, and when the
 * variable is unset every cross-origin browser request is denied. Requests
 * without an Origin header (curl, server-to-server) are unaffected.
 */
export function buildCorsOptions(
  env: Record<string, string | undefined>,
): cors.CorsOptions {
  const raw = env.CORS_ORIGIN?.trim();
  const origins = raw
    ? raw
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];
  const permissive = env.NODE_ENV !== "production";
  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, permissive || origins.includes(origin));
    },
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "x-request-id"],
    maxAge: 86_400,
  };
}

/** Maps a thrown error to an HTTP status, honoring body-parser's 4xx errors. */
function resolveErrorStatus(err: unknown): number {
  if (err !== null && typeof err === "object") {
    const record = err as Record<string, unknown>;
    const candidate =
      typeof record.status === "number"
        ? record.status
        : typeof record.statusCode === "number"
          ? record.statusCode
          : undefined;
    if (typeof candidate === "number" && candidate >= 400 && candidate < 600) {
      return Math.trunc(candidate);
    }
  }
  return 500;
}

function errorMessage(status: number): string {
  if (status === 413) return "Payload too large";
  if (status >= 500) return "Internal server error";
  return "Bad request";
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    genReqId: createRequestIdGenerator(),
    wrapSerializers: false,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url ? redactUrl(req.url) : undefined,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
      err(err) {
        return serializeError(err);
      },
    },
    customLogLevel(_req, res) {
      if (res.statusCode >= 500) {
        return "error";
      }
      if (res.statusCode >= 400) {
        return "warn";
      }
      return "info";
    },
    customSuccessMessage: () => "request completed",
    customErrorMessage: () => "request errored",
  }),
);
app.use(cors(buildCorsOptions(process.env)));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=63072000");
  next();
});
app.use(express.json());

app.use("/api", router);

app.use((_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(404).json({ error: "Not found" });
});

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    req.log.error({ err, requestId: req.id }, "Unhandled error");
    const status = resolveErrorStatus(err);
    res.setHeader("Cache-Control", "no-store");
    res.status(status).json({ error: errorMessage(status) });
  },
);

export default app;
