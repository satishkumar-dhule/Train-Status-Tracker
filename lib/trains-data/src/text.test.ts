import { describe, expect, it } from "vitest";
import { stripHtml } from "./text";

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<b>Hello</b> <i>world</i>")).toBe("Hello world");
  });

  it("trims surrounding whitespace", () => {
    expect(stripHtml("  <p>text</p>  ")).toBe("text");
  });

  it("returns null for empty results", () => {
    expect(stripHtml("<b></b>")).toBeNull();
    expect(stripHtml("   ")).toBeNull();
  });

  it("returns null for falsy input", () => {
    expect(stripHtml(null)).toBeNull();
    expect(stripHtml(undefined)).toBeNull();
    expect(stripHtml("")).toBeNull();
  });
});
