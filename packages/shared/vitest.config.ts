import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/sms/**/*.ts", "src/cluster/**/*.ts", "src/geo/**/*.ts", "src/routing/**/*.ts", "src/clinical/**/*.ts", "src/hospital/**/*.ts", "src/thresholds.ts"],
      exclude: ["**/*.test.ts", "src/routing/testing/**"],
      // PRD NFR-S2-1: at least 90% on the SMS, cluster, geo and routing code.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
