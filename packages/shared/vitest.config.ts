import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/sms/**/*.ts", "src/thresholds.ts"],
      exclude: ["**/*.test.ts"],
      // PRD NFR-S2-1: at least 90% on the SMS module.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
