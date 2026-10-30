import type { Database } from "@solvex-dergana/db";
import { masterIncidents, rawAlerts } from "@solvex-dergana/db/schema/index";
import { asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";

/** All incidents, most recently updated first. This is the snapshot the dispatcher queue starts from. */
export async function listIncidents(db: Database) {
  return db
    .select({
      ...getTableColumns(masterIncidents),
      /** True when any of its alerts came through the emulated network: the UI must badge it (NFR-P5). */
      emulated: sql<boolean>`coalesce((select bool_or(${rawAlerts.emulated}) from ${rawAlerts} where ${rawAlerts.incidentId} = ${masterIncidents.id}), false)`,
    })
    .from(masterIncidents)
    .orderBy(desc(masterIncidents.lastAlertAt));
}

/** One incident with every raw alert that belongs to it, oldest first. Null if it does not exist. */
export async function getIncident(db: Database, id: string) {
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, id));
  if (!incident) return null;
  const alerts = await db
    .select()
    .from(rawAlerts)
    .where(eq(rawAlerts.incidentId, id))
    .orderBy(asc(rawAlerts.receivedAt));
  return { ...incident, alerts };
}

/** Raw alerts that belong to no incident (e.g. text that was not an SVX alert), newest first. */
export async function listUnlinkedAlerts(db: Database) {
  return db.select().from(rawAlerts).where(isNull(rawAlerts.incidentId)).orderBy(desc(rawAlerts.receivedAt));
}
