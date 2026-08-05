import type { Exception } from "@opentelemetry/api";

/**
 * Redacts a request URL down to its path: strips the query string (which
 * carries the `train_number` / `departure_date` parameters) and any embedded
 * userinfo credentials. Inputs that are not URLs are returned as-is.
 */
export function redactUrl(rawUrl: string): string {
  const withoutQuery = rawUrl.split("?")[0] ?? rawUrl;
  if (withoutQuery === "") {
    return withoutQuery;
  }
  try {
    const parsed = new URL(withoutQuery);
    if (parsed.username !== "" || parsed.password !== "") {
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    }
  } catch {
    // Relative paths (e.g. `req.url`) are not parseable as absolute URLs.
  }
  return withoutQuery;
}

/**
 * Normalizes a thrown value into an OTel {@link Exception} carrying only its
 * `name` and `message`. Stack traces expose absolute filesystem paths and are
 * deliberately not recorded on spans; full stacks remain in server logs.
 */
export function sanitizeException(err: unknown): Exception {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  if (err !== null && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    return {
      name: "Error",
      message: typeof message === "string" ? message : "",
    };
  }
  if (typeof err === "string") {
    return { name: "Error", message: err };
  }
  return { name: "Error", message: "" };
}
