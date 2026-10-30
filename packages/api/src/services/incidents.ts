import type { Database } from "@solvex-dergana/db";
import {
  ambulanceUnits,
  dispatches,
  hospitalsMatrix,
  incidentEvents,
  masterIncidents,
  medicalProfiles,
  rawAlerts,
  zones,
} from "@solvex-dergana/db/schema/index";
import { routeAuthority } from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";

import type { AppUserContext } from "../context";
import type { EventBus } from "./events";
import type { SmsTransport } from "../sms/transport";

/** Resolves the target authority, contact phone and reason for an incident from urban zones (FR-S2-19, FR-S5-05). */
export async function resolveAuthorityForIncident(
  db: Database,
  incident: Pick<typeof masterIncidents.$inferSelect, "lat" | "lng" | "roadRef" | "recAuthority">,
) {
  const urbanZones = await db.select().from(zones);
  const authRoute = routeAuthority(incident.lat, incident.lng, urbanZones, incident.roadRef);
  const authority = incident.recAuthority ?? authRoute?.authority ?? "gendarmerie_nationale";
  const phone = authRoute?.phones[0] ?? (authority === "surete_nationale" ? "17" : "1055");
  const reason =
    authRoute?.reason ??
    (incident.recAuthority === "surete_nationale"
      ? "Périmètre urbain"
      : incident.recAuthority === "gendarmerie_nationale"
        ? "Hors périmètre urbain"
        : null);

  return { authority, phone, reason };
}

/** All incidents, most recently updated first. This is the snapshot the dispatcher queue starts from. */
export async function listIncidents(db: Database) {
  return db
    .select({
      ...getTableColumns(masterIncidents),
      /** True when any of its alerts came through the emulated network: the UI must badge it (NFR-P5). */
      emulated: sql<boolean>`coalesce((select bool_or(${rawAlerts.emulated}) from ${rawAlerts} where ${rawAlerts.incidentId} = ${masterIncidents.id}), false)`,
      /** True when an alert joined it only thanks to the location-uncertainty allowance: to be confirmed. */
      tentative: sql<boolean>`coalesce((select bool_or(${rawAlerts.mergeTentative}) from ${rawAlerts} where ${rawAlerts.incidentId} = ${masterIncidents.id}), false)`,
      /** True when an escalation suggestion exists for this incident (post-dispatch merge, FR-S5-07). */
      hasEscalation: sql<boolean>`coalesce((select exists(select 1 from ${incidentEvents} where ${incidentEvents.incidentId} = ${masterIncidents.id} and ${incidentEvents.type} = 'incident.escalation_suggested')), false)`,
      /** The suggested severity target, if an escalation suggestion exists. */
      escalationTo: sql<string | null>`(select (${incidentEvents.payload}->>'to') from ${incidentEvents} where ${incidentEvents.incidentId} = ${masterIncidents.id} and ${incidentEvents.type} = 'incident.escalation_suggested' order by ${incidentEvents.at} desc limit 1)`,
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
  return { ...incident, alerts, journal };
}

/**
 * The data behind the evaluation card: the incident with the reasons for its recommendation, the escalation
 * suggested after the dispatch, and the authority to notify. Null if the incident does not exist.
 */
export async function getEvaluation(db: Database, id: string) {
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, id));
  if (!incident) return null;

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

  // Authority rationale
  const resolvedAuth = await resolveAuthorityForIncident(db, incident);
  const authorityReason =
    (latest?.payload as Record<string, unknown> | undefined)?.authorityReason as string | undefined ??
    resolvedAuth.reason;

  // Authority notification history
  const [notified] = await db
    .select({ payload: incidentEvents.payload, at: incidentEvents.at })
    .from(incidentEvents)
    .where(and(eq(incidentEvents.incidentId, id), eq(incidentEvents.type, "authority.notified")))
    .orderBy(desc(incidentEvents.at))
    .limit(1);
  const authorityNotification = notified
    ? {
        authority: String((notified.payload as Record<string, unknown>).authority ?? incident.recAuthority),
        phone: String((notified.payload as Record<string, unknown>).phone ?? ""),
        notifiedAt: notified.at.toISOString(),
      }
    : null;

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

  return { ...incident, alerts, journal, reasons, escalation, authorityReason, authorityNotification };
}

/** Notifies the relevant authority (Police / Gendarmerie) by SMS and logs it (FR-S5-05). */
export async function notifyAuthority(
  db: Database,
  smsTransport: SmsTransport,
  events: EventBus,
  appUser: AppUserContext,
  incidentId: string,
) {
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, incidentId));
  if (!incident) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Incident not found" });
  }

  const { authority: targetAuthority, phone } = await resolveAuthorityForIncident(db, incident);

  // Summary SMS text (FR-S5-05)
  const ref = incident.id.slice(0, 8).toUpperCase();
  const place = incident.commune ?? (incident.lat && incident.lng ? `${incident.lat.toFixed(4)},${incident.lng.toFixed(4)}` : "Position à confirmer");
  const victims = incident.estimatedVictims ? `${incident.estimatedVictims} victime(s)` : "victimes non précisées";
  const units = (incident.recUnits ?? []).map((u) => `${u.type} (${u.count})`).join(", ") || "VSAV";
  const body = `SVX ALERTE #${ref} - Gravite ${incident.recSeverity.toUpperCase()} - Lieu: ${place} - ${victims} - Moyens: ${units}`;

  await smsTransport.send(phone, body, { incidentId });

  const now = new Date();
  await db.insert(incidentEvents).values({
    incidentId,
    actorRole: "dispatcher",
    actorId: appUser.id,
    type: "authority.notified",
    payload: {
      authority: targetAuthority,
      phone,
      body,
      at: now.toISOString(),
    },
    at: now,
  });

  // If a dispatch record exists for this incident, mark it
  await db
    .update(dispatches)
    .set({ authorityNotified: true, authorityNotifiedAt: now })
    .where(eq(dispatches.incidentId, incidentId));

  // Announce the update to listening dispatchers
  events.publish({ type: "incident.updated", incident });

  return {
    ok: true,
    authority: targetAuthority,
    phone,
    notifiedAt: now.toISOString(),
  };
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
