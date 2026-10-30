import { defineConfig } from "vitest/config";

export default defineConfig({
  // Most tests start an in-process Postgres (PGlite); on a busy machine that can take more than the default 5 s.
  test: { testTimeout: 20_000 },
});
