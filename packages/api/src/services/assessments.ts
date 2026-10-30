import type { Database } from "@solvex-dergana/db";
import {
  handovers,
  hospitalsMatrix,
  incidentEvents,
  masterIncidents,
  medicalProfiles,
  medicAssessments,
  zones,
} from "@solvex-dergana/db/schema/index";
import {
  ageYears,
  assessVictim,
  hospitalFromRow,
  recommendForBilan,
  VITTEL_ITEMS,
  type VittelState,
} from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";

import type { AppUserContext } from "../context";
import { algiersRoadGraph } from "./road-graph";

export type AssessmentInput = {
  incidentId: string;
  unitId?: string;
  victimIndex: number;
  profileId?: string;
  estAge?: number;
  sex?: "male" | "female" | "unknown";
  /** What the medic ticked. Whatever source the client claims, it is stored as "medic". */
  vittel?: Partial<VittelState>;
  gcs?: number;
  hr?: number;
  sbp?: number;
  dbp?: number;
  spo2?: number;
  rr?: number;
  suspectedInjuries: string[];
  treatments: string[];
  /** The hospital the medic picked. Another one than the recommended needs `overrideReason`. */
  chosenHospitalId?: string;
  overrideReason?: string;
};

/** The ambulance this save is for: a medic's own; the admin (demo operator) names one. */
function unitFor(appUser: AppUserContext, requested: string | undefined): string | null {
  if (appUser.role === "admin") return requested ?? null;
  if (!appUser.unitId || (requested && requested !== appUser.unitId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This ambulance is not yours" });
  }
  return appUser.unitId;
}

/** Keeps only criteria the frozen Vittel list knows, and stamps them as the medic's own answers. */
function medicEntries(entries: Partial<VittelState> | undefined): Partial<VittelState> {
  const state: Partial<VittelState> = {};
  for (const { level, id } of VITTEL_ITEMS) {
    const item = entries?.[level]?.[id];
    if (item) (state[level] ??= {})[id] = { value: item.value, source: "medic" };
  }
  return state;
}

/**
 * Saves one victim's bilan. The Shock Index and the Vittel verdict are always computed here from the raw
 * measures (PRD FR-S6-04); nothing the client computed is trusted. Saving the same victim again updates it.
 */
export async function saveAssessment(
  db: Database,
  appUser: AppUserContext,
  input: AssessmentInput,
  now = new Date(),
) {
  const unitId = unitFor(appUser, input.unitId);
  // Reference data does not change with this save: read it before taking the lock on the incident.
  const hospitalRows = await db.select().from(hospitalsMatrix);
  const zonePolygons = (await db.select({ polygon: zones.polygon }).from(zones)).map((z) => z.polygon);

  return db.transaction(async (tx) => {
    // Locks the incident, so two saves of the same victim cannot both insert.
    const [incident] = await tx
      .select()
      .from(masterIncidents)
      .where(eq(masterIncidents.id, input.incidentId))
      .for("update");
    if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Incident not found" });

    let profile: typeof medicalProfiles.$inferSelect | undefined;
    if (input.profileId) {
      [profile] = await tx.select().from(medicalProfiles).where(eq(medicalProfiles.id, input.profileId));
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      // Medical data is only for the people this incident was linked to, not any profile a client names.
      if (!incident.linkedProfileIds.includes(profile.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This profile is not linked to the incident" });
      }
    }

    const { age, state, vittel, shockIndex: index } = assessVictim({
      now,
      sensors: incident.vittelPrefill ?? undefined,
      profile: profile
        ? { birthDate: profile.birthDate, pregnancy: profile.pregnancyStatus, medications: profile.medications }
        : null,
      estAge: input.estAge,
      vitals: input,
      medic: medicEntries(input.vittel),
    });

    // Rank the hospitals from the scene, as the tablet does, and keep the result next to the decision.
    const [existing] = await tx
      .select({ id: medicAssessments.id, chosenHospitalId: medicAssessments.chosenHospitalId })
      .from(medicAssessments)
      .where(
        and(
          eq(medicAssessments.incidentId, input.incidentId),
          eq(medicAssessments.victimIndex, input.victimIndex),
          unitId ? eq(medicAssessments.unitId, unitId) : isNull(medicAssessments.unitId),
        ),
      );
    // Hospitals that already diverted this victim are not offered again (PRD FR-S6-05).
    const declined = existing
      ? (
          await tx
            .select({ hospitalId: handovers.hospitalId })
            .from(handovers)
            .where(and(eq(handovers.assessmentId, existing.id), eq(handovers.status, "diverted")))
        ).map((row) => row.hospitalId)
      : [];
    const recommendation =
      incident.lat !== null && incident.lng !== null && hospitalRows.length > 0
        ? recommendForBilan({
            bilan: {
              gcs: input.gcs ?? null,
              sbp: input.sbp ?? null,
              shockIndex: index?.value ?? null,
              ageYears: age,
              pregnant: (profile?.pregnancyStatus ?? "none") !== "none",
              injuries: input.suspectedInjuries,
              vittel: state,
            },
            hospitals: hospitalRows.map(hospitalFromRow),
            origin: [incident.lat, incident.lng],
            graph: algiersRoadGraph(),
            zones: zonePolygons,
            severity: incident.recSeverity,
            declined,
          })
        : null;

    let chosen: NonNullable<typeof recommendation>["ranking"][number] | undefined;
    if (input.chosenHospitalId) {
      if (!hospitalRows.some((h) => h.id === input.chosenHospitalId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Hospital not found" });
      }
      chosen = recommendation?.ranking.find((m) => m.hospitalId === input.chosenHospitalId);
    }
    // Any choice other than the recommended one needs a reason, including when nothing could be recommended.
    const overriding = Boolean(
      input.chosenHospitalId && recommendation && input.chosenHospitalId !== recommendation.recommended?.hospitalId,
    );
    const reason = input.overrideReason?.trim();
    if (overriding && !reason) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Un motif est obligatoire pour choisir un autre hôpital que le recommandé" });
    }
    const eta = chosen ?? recommendation?.recommended ?? null;

    const values = {
      incidentId: input.incidentId,
      unitId,
      victimIndex: input.victimIndex,
      profileId: profile?.id ?? null,
      estAge: profile ? null : (age ?? null),
      sex: input.sex ?? profile?.sex ?? null,
      vittel: state,
      gcs: input.gcs ?? null,
      hr: input.hr ?? null,
      sbp: input.sbp ?? null,
      dbp: input.dbp ?? null,
      spo2: input.spo2 ?? null,
      rr: input.rr ?? null,
      shockIndex: index?.value == null ? null : index.value.toFixed(2),
      suspectedInjuries: input.suspectedInjuries,
      treatments: input.treatments,
      assessedAt: now,
      recHospitalId: recommendation?.recommended?.hospitalId ?? null,
      recRanking: recommendation
        ? recommendation.ranking.map(({ hospitalId, etaMin, etaSource, matched, missing, diverting, score, scoreBreakdown, flags }) => ({
            hospitalId, etaMin, etaSource, matched, missing, diverting, score, scoreBreakdown, flags,
          }))
        : null,
      chosenHospitalId: input.chosenHospitalId ?? null,
      overrideReason: overriding ? reason! : null,
      etaMinutes: eta?.etaMin ?? null,
    };

    let assessmentId: string;
    if (existing) {
      await tx.update(medicAssessments).set(values).where(eq(medicAssessments.id, existing.id));
      assessmentId = existing.id;
    } else {
      const [created] = await tx.insert(medicAssessments).values(values).returning({ id: medicAssessments.id });
      assessmentId = created!.id;
    }

    // The decision goes in the incident history (PRD FR-S3-23), once for each change of mind.
    if (input.chosenHospitalId && input.chosenHospitalId !== existing?.chosenHospitalId) {
      await tx.insert(incidentEvents).values({
        incidentId: input.incidentId,
        actorRole: appUser.role,
        actorId: appUser.id,
        type: "hospital.chosen",
        payload: {
          assessmentId,
          chosen: input.chosenHospitalId,
          recommended: recommendation?.recommended?.hospitalId ?? null,
          overridden: overriding,
          reason: overriding ? reason! : null,
        },
      });
    }
    return { assessmentId, shockIndex: index, vittel, vittelState: state, recommendation };
  });
}

/** Incidents a medic can work on: everything still in progress, most recent first. */
export async function listOpenIncidents(db: Database) {
  return db
    .select({
      id: masterIncidents.id,
      status: masterIncidents.status,
      lat: masterIncidents.lat,
      lng: masterIncidents.lng,
      recSeverity: masterIncidents.recSeverity,
      alertCount: masterIncidents.alertCount,
      firstAlertAt: masterIncidents.firstAlertAt,
    })
    .from(masterIncidents)
    .where(notInArray(masterIncidents.status, ["closed", "false_alarm", "handed_over"]))
    .orderBy(desc(masterIncidents.lastAlertAt));
}

/**
 * What the bilan screen needs for one incident: the incident with its sensor prefill, the linked profiles
 * (medical data only, no contact details or short code) and the victims this ambulance already recorded.
 */
export async function getMission(db: Database, appUser: AppUserContext, incidentId: string, now = new Date()) {
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, incidentId));
  if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Incident not found" });

  const profiles = incident.linkedProfileIds.length
    ? await db.select().from(medicalProfiles).where(inArray(medicalProfiles.id, incident.linkedProfileIds))
    : [];
  const unitId = unitFor(appUser, undefined);
  const assessments = await db
    .select()
    .from(medicAssessments)
    .where(
      and(
        eq(medicAssessments.incidentId, incidentId),
        unitId ? eq(medicAssessments.unitId, unitId) : undefined,
      ),
    )
    .orderBy(asc(medicAssessments.victimIndex));

  return {
    incident: {
      id: incident.id,
      status: incident.status,
      lat: incident.lat,
      lng: incident.lng,
      recSeverity: incident.recSeverity,
      alertCount: incident.alertCount,
      vittelPrefill: incident.vittelPrefill,
    },
    profiles: profiles.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      birthDate: p.birthDate,
      ageYears: ageYears(p.birthDate, now),
      sex: p.sex,
      bloodType: p.bloodType,
      allergies: p.allergies,
      chronicConditions: p.chronicConditions,
      medications: p.medications,
      pregnancyStatus: p.pregnancyStatus,
    })),
    assessments,
  };
}

/** What the tablet needs to rank hospitals by itself: every hospital, in a stable order, and the city zones. */
export async function orientationData(db: Database) {
  const hospitals = await db.select().from(hospitalsMatrix).orderBy(asc(hospitalsMatrix.name));
  const zoneRows = await db.select({ polygon: zones.polygon }).from(zones);
  return { hospitals, zones: zoneRows.map((z) => z.polygon) };
}
