import type { Database } from "@solvex-dergana/db";
import {
  incidentEvents,
  masterIncidents,
  rawAlerts,
} from "@solvex-dergana/db/schema/index";
import { TRPCError } from "@trpc/server";
import { eq, inArray, sql } from "drizzle-orm";
import { confidence } from "@solvex-dergana/shared";
import type { AppUserContext } from "../context";

export async function markFalseAlarm(
  db: Database,
  actor: AppUserContext,
  input: { id: string; version: number; reason: string },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4007001)`);
    const [incident] = await tx
      .select()
      .from(masterIncidents)
      .where(eq(masterIncidents.id, input.id))
      .for("update");
    if (!incident)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Incident introuvable",
      });
    if (incident.version !== input.version)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Incident modifié : actualisez avant de réessayer.",
      });
    const [updated] = await tx
      .update(masterIncidents)
      .set({ status: "false_alarm", version: incident.version + 1 })
      .where(eq(masterIncidents.id, input.id))
      .returning();
    await tx
      .insert(incidentEvents)
      .values({
        incidentId: input.id,
        actorId: actor.id,
        actorRole: actor.role,
        type: "incident.false_alarm",
        payload: { reason: input.reason, previousStatus: incident.status },
      });
    return updated!;
  });
}

export async function splitIncident(
  db: Database,
  actor: AppUserContext,
  input: { id: string; version: number; alertIds: string[]; reason: string },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4007001)`);
    const [source] = await tx
      .select()
      .from(masterIncidents)
      .where(eq(masterIncidents.id, input.id))
      .for("update");
    if (!source)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Incident introuvable",
      });
    if (source.version !== input.version)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Incident modifié : actualisez avant de réessayer.",
      });
    if (["closed", "false_alarm", "handed_over"].includes(source.status))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cet incident est terminé.",
      });
    const alerts = await tx
      .select()
      .from(rawAlerts)
      .where(eq(rawAlerts.incidentId, input.id));
    const ids = new Set(input.alertIds);
    const moved = alerts.filter((a) => ids.has(a.id));
    const remaining = alerts.filter((a) => !ids.has(a.id));
    if (
      moved.length !== ids.size ||
      remaining.length === 0 ||
      moved.length === 0
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Sélectionnez une partie des signaux de cet incident.",
      });
    const [created] = await tx
      .insert(masterIncidents)
      .values({
        ...summarize(moved),
        commune: source.commune,
        roadRef: source.roadRef,
        pkMarker: source.pkMarker,
      })
      .returning();
    await tx
      .update(rawAlerts)
      .set({ incidentId: created!.id, mergeTentative: false })
      .where(inArray(rawAlerts.id, [...ids]));
    await tx
      .update(masterIncidents)
      .set({ ...summarize(remaining), version: source.version + 1 })
      .where(eq(masterIncidents.id, source.id));
    const payload = {
      sourceId: source.id,
      targetId: created!.id,
      alertIds: [...ids],
      reason: input.reason,
    };
    await tx
      .insert(incidentEvents)
      .values(
        [source.id, created!.id].map((incidentId) => ({
          incidentId,
          actorId: actor.id,
          actorRole: actor.role,
          type: "incident.split",
          payload,
        })),
      );
    return created!;
  });
}

type Alert = typeof rawAlerts.$inferSelect;
/** Rebuild observable facts from the signals remaining on each side of a correction. */
function summarize(alerts: Alert[]) {
  const times = alerts.map((a) => (a.eventAt ?? a.receivedAt).getTime());
  const positioned = alerts
    .filter((a) => a.lat !== null && a.lng !== null)
    .sort((a, b) => (a.accuracyM ?? Infinity) - (b.accuracyM ?? Infinity));
  const position = positioned[0];
  const victims = alerts.flatMap((a) =>
    a.victims === null ? [] : [a.victims],
  );
  return {
    alertCount: alerts.length,
    firstAlertAt: new Date(Math.min(...times)),
    lastAlertAt: new Date(Math.max(...times)),
    lat: position?.lat ?? null,
    lng: position?.lng ?? null,
    geohash8: position?.geohash ?? null,
    locationUncertaintyM: position?.accuracyM ?? null,
    estimatedVictims: victims.length ? Math.max(...victims) : null,
    linkedProfileIds: [
      ...new Set(alerts.flatMap((a) => (a.profileId ? [a.profileId] : []))),
    ],
    confidenceScore: confidence(
      alerts.flatMap((a) =>
        a.source === "unknown"
          ? []
          : [
              {
                source: a.source,
                authenticated: a.authenticated,
                crcValid: !(a.parseErrors ?? []).some(
                  (e) => e === "bad_crc" || e === "missing_crc",
                ),
              },
            ],
      ),
    ).toFixed(3),
  };
}

export async function mergeIncidents(
  db: Database,
  actor: AppUserContext,
  input: {
    sourceId: string;
    targetId: string;
    sourceVersion: number;
    targetVersion: number;
    reason: string;
  },
) {
  if (input.sourceId === input.targetId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choisissez deux incidents distincts.",
    });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4007001)`);
    const incidents = await tx
      .select()
      .from(masterIncidents)
      .where(inArray(masterIncidents.id, [input.sourceId, input.targetId]))
      .orderBy(masterIncidents.id)
      .for("update");
    const source = incidents.find((i) => i.id === input.sourceId);
    const target = incidents.find((i) => i.id === input.targetId);
    if (!source || !target)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Incident introuvable",
      });
    if (
      source.version !== input.sourceVersion ||
      target.version !== input.targetVersion
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Incident modifié : actualisez avant de réessayer.",
      });
    if (
      [source, target].some((i) =>
        ["closed", "false_alarm", "handed_over"].includes(i.status),
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cet incident est terminé.",
      });
    const alerts = await tx
      .select()
      .from(rawAlerts)
      .where(inArray(rawAlerts.incidentId, [source.id, target.id]));
    await tx
      .update(rawAlerts)
      .set({ incidentId: target.id, mergeTentative: false })
      .where(eq(rawAlerts.incidentId, source.id));
    const [updatedTarget] = await tx
      .update(masterIncidents)
      .set({ ...summarize(alerts), version: target.version + 1 })
      .where(eq(masterIncidents.id, target.id))
      .returning();
    const [updatedSource] = await tx
      .update(masterIncidents)
      .set({
        status: "closed",
        alertCount: 0,
        linkedProfileIds: [],
        estimatedVictims: null,
        confidenceScore: "0",
        version: source.version + 1,
      })
      .where(eq(masterIncidents.id, source.id))
      .returning();
    await tx
      .insert(incidentEvents)
      .values(
        [source.id, target.id].map((incidentId) => ({
          incidentId,
          actorRole: actor.role,
          actorId: actor.id,
          type: "incident.merged",
          payload: {
            sourceId: source.id,
            targetId: target.id,
            reason: input.reason,
          },
        })),
      );
    return { source: updatedSource!, target: updatedTarget! };
  });
}
