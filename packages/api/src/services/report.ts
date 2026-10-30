import { masterIncidents } from "@solvex-dergana/db/schema/index";
import { eq, sql } from "drizzle-orm";

import { placeAlert, type PlacementInput } from "./clustering";
import type { SmsFlowDeps } from "./sms-flow";

/** Where a caller said it happened, in words (a commune, or a road kilometre point). */
export type SaidPlace = { commune?: string; roadRef?: string; pk?: number };

/**
 * Files an alert reported through a menu (SMS menu, USSD): places it in an incident (merging with one already open
 * for the same crash), notes where the caller said it was, and tells the dispatchers.
 * Returns null when this exact alert had already been filed.
 */
export async function fileReport(
  { db, events }: Pick<SmsFlowDeps, "db" | "events">,
  input: PlacementInput & { said?: SaidPlace },
) {
  const { said, ...placement } = input;
  const placed = await placeAlert(db, placement);
  if (placed.kind === "duplicate") return null;

  const [incident] = await db
    .update(masterIncidents)
    .set({
      // An incident that already says where it is keeps that.
      commune: sql`coalesce(${masterIncidents.commune}, ${said?.commune ?? null})`,
      roadRef: sql`coalesce(${masterIncidents.roadRef}, ${said?.roadRef ?? null})`,
      pkMarker: sql`coalesce(${masterIncidents.pkMarker}, ${said?.pk === undefined ? null : `PK ${said.pk}`})`,
    })
    .where(eq(masterIncidents.id, placed.incident.id))
    .returning();
  events.publish({ type: placed.kind === "created" ? "incident.created" : "incident.updated", incident: incident! });
  return incident!;
}
