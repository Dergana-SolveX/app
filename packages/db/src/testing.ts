import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";

import type { Database } from "./index";
import { relations } from "./relations";

/**
 * A fresh in-process Postgres (PGlite) with the real migrations applied, for tests.
 * Each call is an isolated database. Typed as `Database` so services under test take it unchanged.
 */
export async function createTestDb(): Promise<Database> {
  const client = new PGlite();
  const db = drizzle({ client, relations });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
  });
  return db as unknown as Database;
}
