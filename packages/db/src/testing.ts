import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";

import type { Database } from "./index";
import { relations } from "./relations";

let migrated: Promise<Blob | File> | undefined;

/** Applies the real migrations once and keeps a snapshot of the result. */
function migratedSnapshot() {
  migrated ??= (async () => {
    const client = new PGlite();
    await migrate(drizzle({ client, relations }), {
      migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
    });
    const snapshot = await client.dumpDataDir("none");
    await client.close();
    return snapshot;
  })();
  // A failed first migration must not poison every later test: try again next time.
  migrated.catch(() => {
    migrated = undefined;
  });
  return migrated;
}

/**
 * A fresh in-process Postgres (PGlite) with the real migrations applied, for tests.
 * Each call is an isolated database, started from a snapshot taken after migrating once,
 * so it stays fast as migrations accumulate. Typed as `Database` so services under test take it unchanged.
 */
export async function createTestDb(): Promise<Database> {
  const client = new PGlite({ loadDataDir: await migratedSnapshot() });
  return drizzle({ client, relations }) as unknown as Database;
}
