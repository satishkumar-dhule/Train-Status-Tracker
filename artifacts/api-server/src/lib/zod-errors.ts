/**
 * Minimal structural views of a zod error. `zodErrorMessage` only reads the
 * first issue and a few fields per issue, so it accepts a real
 * `zod.ZodError` or a hand-built equivalent without depending on zod at all.
 */
interface ZodIssueLike {
  code: string;
  message: string;
  path: readonly PropertyKey[];
  expected?: unknown;
  received?: unknown;
}

interface ZodErrorLike {
  issues: readonly ZodIssueLike[];
}

/**
 * Formats a ZodError as a concise single human-readable message derived from
 * the first issue, e.g. `train_number: Required` or `train_number: expected
 * string, received array`. Nested paths are joined with `.`; when the path is
 * empty the issue detail is returned alone. Never emits the full JSON issue
 * list.
 */
export function zodErrorMessage(error: ZodErrorLike): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid request parameters";
  }

  const detail =
    issue.code === "invalid_type" &&
    issue.expected !== undefined &&
    issue.received !== undefined
      ? `expected ${String(issue.expected)}, received ${String(issue.received)}`
      : issue.message;

  return issue.path.length === 0
    ? detail
    : `${issue.path.join(".")}: ${detail}`;
}
