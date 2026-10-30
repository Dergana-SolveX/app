import type { Database } from "@solvex-dergana/db";
import {
  ambulanceUnits,
  appUsers,
  dispatches,
  incidentEvents,
  masterIncidents,
  medicalProfiles,
} from "@solvex-dergana/db/schema/index";
import { dispatchDiffers, haversineM, profileRisk } from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { and, arrayContains, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { AppUserContext } from "../context";
import type { EventBus } from "./events";

/** The dispatch form for an incident: what the triage recommends, who could go, and who is prefilled. */
export async function getDispatchRecommendation(db: Database, incidentId: string) {
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, incidentId));
  if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown incident" });

  const units = await db.select().from(ambulanceUnits).where(eq(ambulanceUnits.available, true));
  // A unit already on another mission stays offered (the dispatcher decides) but is flagged, so nobody takes a crew off a mission by accident.
  const active = await db
    .select({ incidentId: dispatches.incidentId, unitIds: dispatches.unitIds })
    .from(dispatches)
    .innerJoin(masterIncidents, eq(masterIncidents.id, dispatches.incidentId))
    .where(and(inArray(masterIncidents.status, ["dispatched", "on_scene", "transporting"]), ne(dispatches.incidentId, incidentId)))
    .orderBy(asc(dispatches.decidedAt));
  const busyWith = (unitId: string) => active.findLast((row) => row.unitIds.includes(unitId))?.incidentId ?? null;
  const { lat, lng } = incident;
  const candidates = units
    .map((unit) => ({
      id: unit.id,
      callSign: unit.callSign,
      type: unit.type,
      baseName: unit.baseName,
      busyWith: busyWith(unit.id),
      distanceM: lat !== null && lng !== null ? haversineM(lat, lng, unit.lat, unit.lng) : null,
    }))
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || a.callSign.localeCompare(b.callSign));

  const recommended = incident.recUnits ?? [];
  const taken = new Set<string>();
  const prefill: string[] = [];
  const notices: string[] = [];
  const takeNearest = (type: string, count: number) => {
    const units = candidates.filter((c) => c.type === type && !taken.has(c.id)).slice(0, count);
    for (const unit of units) {
      taken.add(unit.id);
      prefill.push(unit.id);
    }
    return units.length;
  };

  for (const { type, count } of recommended) {
    const missing = count - takeNearest(type, count);
    if (missing === 0) continue;
    if (type === "ambulance_medicalisee") {
      // Waiting for a medicalised ambulance costs time: a VSAV can start first aid now.
      const sent = takeNearest("vsav_standard", missing);
      notices.push(
        sent > 0
          ? "Aucune ambulance médicalisée disponible : envoyer un VSAV maintenant pour démarrer les premiers soins."
          : "Aucune ambulance médicalisée ni VSAV disponible.",
      );
    } else {
      notices.push(`Unité recommandée indisponible : ${type === "desincarceration" ? "désincarcération" : "VSAV"}.`);
    }
  }

  // Once a dispatcher has decided, the form shows that decision (never the recommendation again).
  const [decided] = await db
    .select({ dispatch: dispatches, dispatcher: appUsers.name })
    .from(dispatches)
    .leftJoin(appUsers, eq(appUsers.id, dispatches.dispatcherId))
    .where(eq(dispatches.incidentId, incidentId))
    .orderBy(asc(dispatches.decidedAt))
    .limit(1);
  const decision = decided
    ? {
        dispatcherName: decided.dispatcher,
        decidedAt: decided.dispatch.decidedAt,
        modified: decided.dispatch.modified,
        reason: decided.dispatch.modificationReason,
        notes: (decided.dispatch.decided as { notes?: string | null }).notes ?? null,
        units: (decided.dispatch.decided as { units?: { id: string; callSign: string; type: string }[] }).units ?? [],
      }
    : null;

  return {
    incidentId,
    version: incident.version,
    status: incident.status,
    recommended,
    candidates,
    prefill,
    decision,
    /** Why the prefill differs from the recommendation, or null when it matches. */
    notice: notices.length > 0 ? notices.join(" ") : null,
  };
}

export type ApproveInput = {
  incidentId: string;
  /** The `version` of the incident the dispatcher saw on the form: a stale form is refused. */
  expectedVersion: number;
  unitIds: string[];
  /** Mandatory when the units differ from the recommendation. */
  reason?: string;
  /** Free text for the crew (shown on the unit's mission screen). */
  notes?: string;
};

/**
 * The dispatcher's decision (FR-S5-06). The recommendation is kept untouched next to what the human decided,
 * and both go to the journal (NFR-P1). Only one decision per incident wins: the lock is the incident row.
 */
export async function approveDispatch(
  { db, events }: { db: Database; events: EventBus },
  appUser: AppUserContext,
  input: ApproveInput,
) {
  const result = await db.transaction(async (tx) => {
    const [incident] = await tx.select().from(masterIncidents).where(eq(masterIncidents.id, input.incidentId)).for("update");
    if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown incident" });
    if (incident.status !== "open") {
      const [first] = await tx
        .select({ name: appUsers.name })
        .from(dispatches)
        .leftJoin(appUsers, eq(appUsers.id, dispatches.dispatcherId))
        .where(eq(dispatches.incidentId, incident.id))
        .orderBy(asc(dispatches.decidedAt))
        .limit(1);
      throw new TRPCError({
        code: "CONFLICT",
        message: first ? `Déjà traité par ${first.name ?? "un autre dispatcher"}` : "Cet incident n'est plus ouvert",
      });
    }
    if (incident.version !== input.expectedVersion) {
      throw new TRPCError({ code: "CONFLICT", message: "L'incident a changé : rechargez le formulaire" });
    }

    const units = await tx.select().from(ambulanceUnits).where(inArray(ambulanceUnits.id, input.unitIds));
    const chosen = input.unitIds.map((id) => units.find((unit) => unit.id === id && unit.available));
    if (chosen.some((unit) => unit === undefined)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Unité inconnue ou indisponible" });
    }

    const recommendedUnits = incident.recUnits ?? [];
    const modified = dispatchDiffers(recommendedUnits, chosen.map((unit) => unit!.type));
    const reason = input.reason?.trim();
    if (modified && !reason) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Un motif est obligatoire quand le dispatch diffère de la recommandation" });
    }

    const [stored] = await tx
      .insert(dispatches)
      .values({
        incidentId: incident.id,
        recommended: { severity: incident.recSeverity, units: recommendedUnits, authority: incident.recAuthority },
        decided: {
          unitIds: input.unitIds,
          units: chosen.map((unit) => ({ id: unit!.id, callSign: unit!.callSign, type: unit!.type })),
          notes: input.notes?.trim() || null,
        },
        modified,
        modificationReason: modified ? reason! : null,
        dispatcherId: appUser.id,
        unitIds: input.unitIds,
      })
      .returning();

    const [updated] = await tx
      .update(masterIncidents)
      .set({ status: "dispatched", version: incident.version + 1 })
      .where(eq(masterIncidents.id, incident.id))
      .returning();

    await tx.insert(incidentEvents).values({
      incidentId: incident.id,
      actorRole: appUser.role,
      actorId: appUser.id,
      type: modified ? "dispatch.modified" : "dispatch.approved",
      payload: { dispatchId: stored!.id, unitIds: input.unitIds, modified, reason: reason ?? null },
    });
    return { dispatch: stored!, incident: updated! };
  });

  events.publish({ type: "incident.updated", incident: result.incident });
  // Each assigned ambulance hears about it on its own channel, once the decision is committed.
  for (const unitId of input.unitIds) {
    events.publishToUnit(unitId, {
      type: "dispatch.assigned",
      dispatchId: result.dispatch.id,
      incidentId: input.incidentId,
      unitId,
      unitIds: input.unitIds,
      notes: input.notes?.trim() || null,
      at: result.dispatch.decidedAt.toISOString(),
    });
  }
  return result;
}

/** An ambulance's own business: a medic may act for their unit only; the admin (demo operator) for any. */
export function assertOwnUnit(appUser: AppUserContext, unitId: string) {
  if (appUser.role !== "admin" && appUser.unitId !== unitId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This ambulance is not yours" });
  }
}

/** The mission an ambulance is on right now, or null: where, how bad, what the dispatcher said (FR-S6-01). */
export async function getCurrentMission(db: Database, appUser: AppUserContext, unitId: string) {
  assertOwnUnit(appUser, unitId);
  const [row] = await db
    .select({ dispatch: dispatches, incident: masterIncidents, dispatcher: appUsers.name })
    .from(dispatches)
    .innerJoin(masterIncidents, eq(masterIncidents.id, dispatches.incidentId))
    .leftJoin(appUsers, eq(appUsers.id, dispatches.dispatcherId))
    .where(
      and(
        arrayContains(dispatches.unitIds, [unitId]),
        inArray(masterIncidents.status, ["dispatched", "on_scene", "transporting"]),
      ),
    )
    .orderBy(desc(dispatches.decidedAt))
    .limit(1);
  if (!row) return null;

  const { dispatch, incident } = row;
  const decided = dispatch.decided as {
    notes?: string | null;
    units?: { id: string; callSign: string; type: string }[];
  };
  const linked = incident.linkedProfileIds.length
    ? await db.select().from(medicalProfiles).where(inArray(medicalProfiles.id, incident.linkedProfileIds))
    : [];
  // Only what the crew must prepare for, never the name or the full record.
  const risks = linked.map((profile) => profileRisk(profile));

  return {
    dispatchId: dispatch.id,
    incidentId: incident.id,
    status: incident.status,
    notes: decided.notes ?? null,
    dispatchedAt: dispatch.decidedAt,
    dispatcherName: row.dispatcher,
    severity: incident.recSeverity,
    victims: incident.estimatedVictims,
    units: decided.units ?? [],
    location: {
      lat: incident.lat,
      lng: incident.lng,
      geohash8: incident.geohash8,
      commune: incident.commune,
      roadRef: incident.roadRef,
      pkMarker: incident.pkMarker,
      uncertaintyM: incident.locationUncertaintyM,
    },
    profileBanner:
      linked.length === 0
        ? null
        : {
            high: risks.some((risk) => risk.level === "high"),
            flags: [...new Set(risks.flatMap((risk) => risk.flags))],
            prepTags: [...new Set(risks.flatMap((risk) => risk.prepTags))],
          },
  };
}

/** « Arrivé sur les lieux »: the first unit to arrive puts the incident on scene. Pressing it again changes nothing. */
export async function markArrived(
  { db, events }: { db: Database; events: EventBus },
  appUser: AppUserContext,
  input: { incidentId: string; unitId: string },
) {
  assertOwnUnit(appUser, input.unitId);

  const updated = await db.transaction(async (tx) => {
    const [incident] = await tx.select().from(masterIncidents).where(eq(masterIncidents.id, input.incidentId)).for("update");
    if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown incident" });

    const [assigned] = await tx
      .select({ id: dispatches.id })
      .from(dispatches)
      .where(and(eq(dispatches.incidentId, incident.id), arrayContains(dispatches.unitIds, [input.unitId])))
      .limit(1);
    if (!assigned) throw new TRPCError({ code: "FORBIDDEN", message: "Cette ambulance n'est pas assignée à cet incident" });
    if (incident.status !== "dispatched" && incident.status !== "on_scene") {
      throw new TRPCError({ code: "CONFLICT", message: "L'incident n'est plus en intervention" });
    }

    const [already] = await tx
      .select({ id: incidentEvents.id })
      .from(incidentEvents)
      .where(
        and(
          eq(incidentEvents.incidentId, incident.id),
          eq(incidentEvents.type, "unit.arrived"),
          sql`${incidentEvents.payload}->>'unitId' = ${input.unitId}`,
        ),
      )
      .limit(1);
    if (already) return null;

    await tx.insert(incidentEvents).values({
      incidentId: incident.id,
      actorRole: appUser.role,
      actorId: appUser.id,
      type: "unit.arrived",
      payload: { unitId: input.unitId },
    });
    if (incident.status === "on_scene") return null;
    const [moved] = await tx
      .update(masterIncidents)
      .set({ status: "on_scene", version: incident.version + 1 })
      .where(eq(masterIncidents.id, incident.id))
      .returning();
    return moved!;
  });

  if (updated) events.publish({ type: "incident.updated", incident: updated });
  return { ok: true as const };
}
