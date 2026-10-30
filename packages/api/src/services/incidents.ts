import { TRPCError } from "@trpc/server";
import type { Database } from "@solvex-dergana/db";
import {
  ambulanceUnits,
  hospitalsMatrix,
  incidentEvents,
  masterIncidents,
  medicalProfiles,
  rawAlerts,
  zones,
} from "@solvex-dergana/db/schema/index";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";

/** All incidents, most recently updated first. This is the snapshot the dispatcher queue starts from. */
export async function listIncidents(db: Database) {
  return db
    .select({
      ...getTableColumns(masterIncidents),
      /** True when any of its alerts came through the emulated network: the UI must badge it (NFR-P5). */
      emulated: sql<boolean>`coalesce((select bool_or(${rawAlerts.emulated}) from ${rawAlerts} where ${rawAlerts.incidentId} = ${masterIncidents.id}), false)`,
      /** True when an alert joined it only thanks to the location-uncertainty allowance: to be confirmed. */
      tentative: sql<boolean>`coalesce((select bool_or(${rawAlerts.mergeTentative}) from ${rawAlerts} where ${rawAlerts.incidentId} = ${masterIncidents.id}), false)`,
    })
    .from(masterIncidents)
    .orderBy(desc(masterIncidents.lastAlertAt));
}

/** One incident with every raw alert that belongs to it, oldest first. Null if it does not exist. */
export async function getIncident(db: Database, id: string) {
  const [incident] = await db
    .select()
    .from(masterIncidents)
    .where(eq(masterIncidents.id, id));
  if (!incident) return null;
  const alerts = await db
    .select()
    .from(rawAlerts)
    .where(eq(rawAlerts.incidentId, id))
    .orderBy(asc(rawAlerts.receivedAt));
  const journal = await db
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, id))
    .orderBy(asc(incidentEvents.at));

  const [latest] = await db
    .select({ payload: incidentEvents.payload })
    .from(incidentEvents)
    .where(and(eq(incidentEvents.incidentId, id), eq(incidentEvents.type, "triage.recommended")))
    .orderBy(desc(incidentEvents.at))
    .limit(1);
  const reasons = (latest?.payload.reasons ?? []) as { fr: string; ar: string }[];

  const [suggested] = await db
    .select({ payload: incidentEvents.payload })
    .from(incidentEvents)
    .where(and(eq(incidentEvents.incidentId, id), eq(incidentEvents.type, "incident.escalation_suggested")))
    .orderBy(desc(incidentEvents.at))
    .limit(1);
  const escalation = suggested
    ? (suggested.payload as { from: string; to: "yellow" | "red"; reasons: { fr: string; ar: string }[] })
    : null;

  return { ...incident, alerts, journal, reasons, escalation };
}

/**
 * The data behind the evaluation card: the incident with the reasons for its recommendation.
 * The reasons come from the latest `triage.recommended` event (the recommendation never changes after dispatch).
 */
export async function getEvaluation(db: Database, id: string) {
  return getIncident(db, id);
}

/** Raw alerts that belong to no incident (e.g. text that was not an SVX alert), newest first. */
export async function listUnlinkedAlerts(db: Database) {
  return db
    .select()
    .from(rawAlerts)
    .where(isNull(rawAlerts.incidentId))
    .orderBy(desc(rawAlerts.receivedAt));
}

/** Audit and read in one transaction: no medical information leaves without its access record. */
export async function getIncidentProfiles(
  db: Database,
  id: string,
  actor: { id: string; role: string },
) {
  return db.transaction(async (tx) => {
    const [incident] = await tx
      .select()
      .from(masterIncidents)
      .where(eq(masterIncidents.id, id));
    if (!incident)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Incident introuvable",
      });
    const linkedAlerts = await tx
      .select({ profileId: rawAlerts.profileId })
      .from(rawAlerts)
      .where(eq(rawAlerts.incidentId, id));
    const ids = [
      ...new Set([
        ...incident.linkedProfileIds,
        ...linkedAlerts.flatMap((a) => (a.profileId ? [a.profileId] : [])),
      ]),
    ];
    if (!ids.length) return [];
    const profiles = await tx
      .select()
      .from(medicalProfiles)
      .where(inArray(medicalProfiles.id, ids));
    await tx
      .insert(incidentEvents)
      .values({
        incidentId: id,
        actorRole: actor.role,
        actorId: actor.id,
        type: "profile.accessed",
        payload: { profileIds: profiles.map((p) => p.id) },
      });
    return profiles.map((p) => ({
      id: p.id,
      shortCode: p.shortCode,
      bloodType: p.bloodType,
      allergies: p.allergies,
      anticoagulant: (p.medications as any[]).some((m) => m?.class === "anticoagulant"),
      unreliableShockIndex: (p.medications as any[]).some(
        (m) => m?.class === "beta_blocker",
      ),
      insulin: (p.medications as any[]).some((m) => m?.class === "insulin"),
    }));
  });
}

export async function getMapLayers(db: Database) {
  const [units, hospitals, perimeters] = await Promise.all([
    db.select().from(ambulanceUnits),
    db.select().from(hospitalsMatrix),
    db.select().from(zones),
  ]);
  return { units, hospitals, zones: perimeters };
}

/** The journal of an incident (every automatic and human decision), oldest first. */
export async function getJournal(db: Database, id: string) {
  return db
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, id))
    .orderBy(asc(incidentEvents.at));
}

export const listIncidentEvents = getJournal;
