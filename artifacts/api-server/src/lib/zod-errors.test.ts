import { describe, expect, it } from "vitest";
import { GetTrainStatusQueryParams } from "@workspace/api-zod";
import { zodErrorMessage } from "./zod-errors";

describe("zodErrorMessage", () => {
  it("reports a missing param as `path: Required`", () => {
    expect(
      zodErrorMessage({
        issues: [{ code: "invalid_type", message: "Required", path: ["train_number"] }],
      }),
    ).toBe("train_number: Required");
  });

  it("reports expected/received for a wrong type (array for a string param)", () => {
    expect(
      zodErrorMessage({
        issues: [
          {
            code: "invalid_type",
            message: "Required",
            expected: "string",
            received: "array",
            path: ["train_number"],
          },
        ],
      }),
    ).toContain("expected string, received array");
  });

  it("uses the issue message for a failed regex validation", () => {
    expect(
      zodErrorMessage({
        issues: [
          {
            code: "invalid_string",
            message: "Invalid",
            path: ["departure_date"],
          },
        ],
      }),
    ).toBe("departure_date: Invalid");
  });

  it("only reports the first issue when multiple exist", () => {
    const error = {
      issues: [
        { code: "invalid_type", message: "Required", path: ["train_number"] },
        { code: "invalid_type", message: "Required", path: ["departure_date"] },
      ],
    };

    expect(error.issues).toHaveLength(2);
    expect(zodErrorMessage(error)).toBe("train_number: Required");
  });

  it("joins nested paths with `.` and uses the message alone for an empty path", () => {
    expect(
      zodErrorMessage({
        issues: [
          {
            code: "invalid_type",
            message: "Required",
            path: ["stations", 1, "code"],
          },
        ],
      }),
    ).toBe("stations.1.code: Required");

    expect(
      zodErrorMessage({
        issues: [
          {
            code: "invalid_type",
            message: "Required",
            expected: "string",
            received: "number",
            path: [],
          },
        ],
      }),
    ).toBe("expected string, received number");
  });

  it("accepts a real ZodError from the generated query schema", () => {
    const result = GetTrainStatusQueryParams.safeParse({
      train_number: "22943",
      departure_date: "abc",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodErrorMessage(result.error)).toBe("departure_date: Invalid");
    }
  });

  it("falls back gracefully for an empty issues list", () => {
    expect(zodErrorMessage({ issues: [] })).toBe("Invalid request parameters");
  });
});
