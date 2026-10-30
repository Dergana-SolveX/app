import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test boots an in-process Postgres (PGlite) and runs the real migrations;
    // that takes several seconds when many test files start at once.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
