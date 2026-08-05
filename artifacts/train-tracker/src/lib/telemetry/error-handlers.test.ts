import { afterEach, describe, expect, it, vi } from "vitest";
import { installGlobalErrorHandlers } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installGlobalErrorHandlers", () => {
  it("captures window error events", () => {
    const onError = vi.fn();
    const cleanup = installGlobalErrorHandlers({ onError });

    const event = new ErrorEvent("error", {
      message: "boom",
      error: new Error("boom"),
    });
    window.dispatchEvent(event);

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, type] = onError.mock.calls[0] as [unknown, string];
    expect(error).toBeInstanceOf(Error);
    expect(type).toBe("error");

    cleanup();
  });

  it("captures string error messages", () => {
    const onError = vi.fn();
    const cleanup = installGlobalErrorHandlers({ onError });

    const event = new ErrorEvent("error", { message: "string failure" });
    window.dispatchEvent(event);

    const [error, type] = onError.mock.calls[0] as [unknown, string];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("string failure");
    expect(type).toBe("error");

    cleanup();
  });

  it("captures unhandled rejections", () => {
    const onError = vi.fn();
    const cleanup = installGlobalErrorHandlers({ onError });

    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {
      value: new Error("rejected"),
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, type] = onError.mock.calls[0] as [unknown, string];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("rejected");
    expect(type).toBe("unhandledrejection");

    cleanup();
  });

  it("removes listeners on cleanup", () => {
    const onError = vi.fn();
    const cleanup = installGlobalErrorHandlers({ onError });
    cleanup();

    window.dispatchEvent(
      new ErrorEvent("error", { message: "after cleanup" }),
    );
    expect(onError).not.toHaveBeenCalled();
  });
});
