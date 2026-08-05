import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { createRequestIdGenerator, logger } from "./lib/logger";

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
          url: req.url?.split("?")[0],
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((_req, res) => {
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
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
