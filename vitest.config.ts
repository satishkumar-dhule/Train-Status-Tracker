import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "artifacts/train-tracker/src/**/*.test.ts",
      "artifacts/api-server/src/**/*.test.ts",
      "lib/**/src/**/*.test.ts",
    ],
  },
});
