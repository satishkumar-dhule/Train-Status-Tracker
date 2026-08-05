import { describe, expect, it } from "vitest";
import { redactUrl, sanitizeException } from "./trace-attributes";

describe("redactUrl", () => {
  it("strips the query string", () => {
    expect(redactUrl("/api/trains/status?train_number=22943&d=20260805")).toBe(
      "/api/trains/status",
    );
  });

  it("leaves URLs without a query unchanged", () => {
    expect(redactUrl("/api/trains/status")).toBe("/api/trains/status");
  });

  it("strips userinfo from absolute URLs", () => {
    expect(redactUrl("https://user:secret@host.example/api/trains")).toBe(
      "https://host.example/api/trains",
    );
  });

  it("strips the fragment as well as the query", () => {
    expect(redactUrl("/api/trains?q=1#section")).toBe("/api/trains");
  });

  it("returns empty strings untouched", () => {
    expect(redactUrl("")).toBe("");
  });

  it("strips credentials even when the query follows them", () => {
    expect(redactUrl("http://u:p@host.example/status?train_number=22943")).toBe(
      "http://host.example/status",
    );
  });
});

describe("sanitizeException", () => {
  it("keeps name and message but strips the stack", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at file.js:1:1";
    expect(sanitizeException(err)).toEqual({
      name: "Error",
      message: "boom",
    });
  });

  it("normalizes non-Error thrown values", () => {
    expect(sanitizeException("oops")).toEqual({
      name: "Error",
      message: "oops",
    });
  });

  it("coerces object throws without a message", () => {
    expect(sanitizeException({ code: 42 })).toEqual({
      name: "Error",
      message: "",
    });
  });
});
