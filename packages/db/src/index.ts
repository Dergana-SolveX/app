import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL_POOLED || env.DATABASE_URL,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
  pool.on("error", () => undefined);
  return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;
export { and, asc, eq, inArray, lte, max } from "drizzle-orm";
export * from "./types";
