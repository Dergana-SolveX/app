import type { Database } from "@solvex-dergana/db";
import { dispatches, incidentEvents, masterIncidents, rawAlerts, zones } from "@solvex-dergana/db/schema/index";
import { routeAuthority } from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";

import type { AppUserContext } from "../context";
import type { EventBus } from "./events";
import type { SmsTransport } from "../sms/transport";

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
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, id));
  if (!incident) return null;
  const alerts = await db
    .select()
    .from(rawAlerts)
    .where(eq(rawAlerts.incidentId, id))
    .orderBy(asc(rawAlerts.receivedAt));
  return { ...incident, alerts };
}

/**
 * The data behind the evaluation card: the incident with the reasons for its recommendation.
 * The reasons come from the latest `triage.recommended` event (the recommendation never changes after dispatch).
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

  // A severity increase suggested after the dispatch (nothing was changed): the card keeps showing it on reload.
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
  const urbanZones = await db.select().from(zones);
  const authRoute = routeAuthority(incident.lat, incident.lng, urbanZones, incident.roadRef);
  const authorityReason =
    (latest?.payload as Record<string, unknown> | undefined)?.authorityReason as string | undefined ??
    authRoute?.reason ??
    (incident.recAuthority === "surete_nationale"
      ? "Périmètre urbain"
      : incident.recAuthority === "gendarmerie_nationale"
        ? "Hors périmètre urbain"
        : null);

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

  return { ...incident, reasons, escalation, authorityReason, authorityNotification };
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

  const urbanZones = await db.select().from(zones);
  const authRoute = routeAuthority(incident.lat, incident.lng, urbanZones, incident.roadRef);
  const targetAuthority = incident.recAuthority ?? authRoute?.authority ?? "gendarmerie_nationale";
  const phone = authRoute?.phones[0] ?? (targetAuthority === "surete_nationale" ? "17" : "1055");

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
  return db.select().from(rawAlerts).where(isNull(rawAlerts.incidentId)).orderBy(desc(rawAlerts.receivedAt));
}

/** The journal of an incident (every automatic and human decision), oldest first. */
export async function listIncidentEvents(db: Database, incidentId: string) {
  return db.select().from(incidentEvents).where(eq(incidentEvents.incidentId, incidentId)).orderBy(asc(incidentEvents.at));
}
