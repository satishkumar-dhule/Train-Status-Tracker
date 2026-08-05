process.env.LOG_LEVEL = "silent";
process.env.REDIS_MODE = "disabled";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
