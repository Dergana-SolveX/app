import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/sms/**/*.ts",
        "src/cluster/**/*.ts",
        "src/geo/**/*.ts",
        "src/routing/**/*.ts",
        "src/clinical/**/*.ts",
        "src/triage/**/*.ts",
        "src/hospital/**/*.ts",
        "src/atmist/**/*.ts",
        "src/chip-sim/**/*.ts",
        "src/thresholds.ts",
      ],
      exclude: ["**/*.test.ts", "src/routing/testing/**"],
      // PRD NFR-S2-1: at least 90% on the SMS, cluster, geo, routing, clinical and triage code.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
