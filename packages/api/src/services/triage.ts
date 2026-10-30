import type { Database } from "@solvex-dergana/db";
import {
  incidentEvents,
  masterIncidents,
  medicalProfiles,
  rawAlerts,
  zones,
} from "@solvex-dergana/db/schema/index";
import {
  decodeGeohash,
  profileRisk,
  routeAuthority,
  triage,
  vittelPrefill,
  type TriageFacts,
} from "@solvex-dergana/shared";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { EventBus } from "./events";

type Incident = typeof masterIncidents.$inferSelect;
type Alert = typeof rawAlerts.$inferSelect;
type Severity = Incident["recSeverity"];

const RANK: Record<Severity, number> = { unknown: 0, green: 1, yellow: 2, red: 3 };

const maxOf = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? Math.max(...present) : null;
};
const anyOf = (values: (boolean | null)[]) => (values.some((v) => v === null) && !values.includes(true) ? null : values.includes(true));

/** What every alert of the incident says, taking the most alarming report for each fact. */
function factsFrom(alerts: Alert[], risk: "high" | null): TriageFacts {
  const consciousReports = alerts.map((a) => a.conscious).filter((c): c is 0 | 1 | 2 => c === 0 || c === 1 || c === 2);
  return {
    fire: anyOf(alerts.map((a) => a.fire)),
    trapped: anyOf(alerts.map((a) => a.trapped)),
    bleeding: anyOf(alerts.map((a) => a.bleeding)),
    rollover: alerts.some((a) => (a.rolloverDeg ?? 0) > 90) || null,
    gForce: maxOf(alerts.map((a) => a.gForce)),
    deltaVKmh: maxOf(alerts.map((a) => a.deltaVKmh)),
    victims: maxOf(alerts.map((a) => a.victims)),
    // "No" from any reporter wins over "yes"; "don't know" only counts when nobody else answered.
    conscious: consciousReports.includes(0) ? 0 : consciousReports.includes(1) ? 1 : consciousReports.includes(2) ? 2 : null,
    profileRisk: risk,
  };
}

type Deps = { db: Database; events: EventBus };

/**
 * Recomputes the automatic recommendation from every alert of the incident (FR-S3-06).
 * - Before a dispatcher has acted: stores it in `rec_*` and logs it.
 * - After: never touches the incident; if the severity went up, only suggests an escalation.
 * Returns the incident as it is stored afterwards, or null if it does not exist.
 * `announce: false` skips the "updated" event (the caller is about to publish "created").
 */
export async function retriageIncident(
  { db, events }: Deps,
  incidentId: string,
  { announce = true }: { announce?: boolean } = {},
): Promise<Incident | null> {
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, incidentId));
  if (!incident) return null;

  const alerts = await db.select().from(rawAlerts).where(eq(rawAlerts.incidentId, incidentId)).orderBy(asc(rawAlerts.receivedAt));
  const profileIds = [...new Set(alerts.map((a) => a.profileId).filter((id): id is string => id !== null))];
  const profiles = profileIds.length > 0 ? await db.select().from(medicalProfiles).where(inArray(medicalProfiles.id, profileIds)) : [];
  const risk = profiles.some((p) => profileRisk(p).level === "high") ? "high" : null;

  const facts = factsFrom(alerts, risk);
  const result = triage(facts);
  const source = alerts.some((a) => a.source === "iot") ? "iot" : "app";
  const prefill = vittelPrefill(facts, source);

  const geohash = incident.geohash8 ?? alerts.find((a) => a.geohash)?.geohash ?? null;
  const point = incident.lat !== null && incident.lng !== null ? { lat: incident.lat, lng: incident.lng } : geohash ? decodeGeohash(geohash) : null;
  const urbanZones = await db.select().from(zones);
  const authority = routeAuthority(point?.lat, point?.lng, urbanZones, incident.roadRef)?.authority ?? null;

  if (incident.status !== "open") {
    const raised = RANK[result.severity] > RANK[incident.recSeverity] && (result.severity === "yellow" || result.severity === "red");
    if (!raised) return incident;
    const previous = await db
      .select({ payload: incidentEvents.payload })
      .from(incidentEvents)
      .where(and(eq(incidentEvents.incidentId, incidentId), eq(incidentEvents.type, "incident.escalation_suggested")));
    if (previous.some((e) => e.payload.to === result.severity)) return incident;

    await db.insert(incidentEvents).values({
      incidentId,
      actorRole: "system",
      type: "incident.escalation_suggested",
      payload: { from: incident.recSeverity, to: result.severity, reasons: result.reasons },
    });
    events.publish({ type: "incident.escalation_suggested", incidentId, from: incident.recSeverity, to: result.severity, reasons: result.reasons });
    return incident;
  }

  const changed =
    incident.recSeverity !== result.severity ||
    incident.recAuthority !== authority ||
    JSON.stringify(incident.recUnits ?? []) !== JSON.stringify(result.units) ||
    JSON.stringify(incident.vittelPrefill ?? {}) !== JSON.stringify(prefill);
  if (!changed) return incident;

  const [updated] = await db
    .update(masterIncidents)
    .set({ recSeverity: result.severity, recUnits: result.units, recAuthority: authority, vittelPrefill: prefill })
    .where(eq(masterIncidents.id, incidentId))
    .returning();
  await db.insert(incidentEvents).values({
    incidentId,
    actorRole: "system",
    type: "triage.recommended",
    payload: { severity: result.severity, units: result.units, authority, reasons: result.reasons, vittelPrefill: prefill },
  });
  if (announce) events.publish({ type: "incident.updated", incident: updated! });
  return updated!;
}
