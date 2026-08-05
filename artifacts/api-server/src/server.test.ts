import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "./server";

afterEach(() => {
  vi.restoreAllMocks();
});

function listenOnEphemeralPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

describe("startServer", () => {
  it("reports a listening event on the configured port", async () => {
    const app = express();
    const port = await listenOnEphemeralPort();
    const onListening = vi.fn();
    const onError = vi.fn();

    const server = startServer(app, port, { onListening, onError });
    await new Promise<void>((resolve) => {
      server.on("listening", () => {
        expect(onListening).toHaveBeenCalledWith(port);
        expect(onError).not.toHaveBeenCalled();
        server.close(() => resolve());
      });
    });
  });

  it("reports a bind error through the error handler instead of crashing", async () => {
    const app = express();
    const port = await listenOnEphemeralPort();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, resolve));

    const onListening = vi.fn();
    const onError = vi.fn();
    const server = startServer(app, port, { onListening, onError });
    await new Promise<void>((resolve) => {
      server.on("error", (err: Error) => {
        expect(onError).toHaveBeenCalledWith(err);
        expect(err.message).toContain("EADDRINUSE");
        expect(onListening).not.toHaveBeenCalled();
        blocker.close(() => resolve());
      });
    });
  });
});
