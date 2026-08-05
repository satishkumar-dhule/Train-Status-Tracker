import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    alias: {
      "@": path.resolve(__dirname, "artifacts/train-tracker/src"),
    },
    include: [
      "artifacts/train-tracker/src/**/*.test.{ts,tsx}",
      "artifacts/api-server/src/**/*.test.{ts,tsx}",
      "lib/**/src/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      include: [
        "artifacts/train-tracker/src/**",
        "artifacts/api-server/src/**",
        "lib/trains-data/src/**",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/components/ui/**",
        "**/generated/**",
        "artifacts/train-tracker/src/main.tsx",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
