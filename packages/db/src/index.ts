import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  const connectionString = env.DATABASE_URL_POOLED || env.DATABASE_URL;
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  pool.on("error", (err) => {
    console.error("[db-pool] Connection error on idle client:", err.message);
  });

  return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;
export * from "./types";
