import type { Database } from "@solvex-dergana/db";
import {
  ambulanceUnits,
  handovers,
  hospitalsMatrix,
  incidentEvents,
  masterIncidents,
  medicalProfiles,
  medicAssessments,
} from "@solvex-dergana/db/schema/index";
import {
  ageYears,
  buildAtMist,
  deriveNeeds,
  evaluateVittel,
  needFacts,
  renderAtMistSms,
  shockIndex,
  type AtMist,
  type Need,
  type VittelState,
} from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, lte, notInArray } from "drizzle-orm";

import type { AppUserContext } from "../context";
import type { EventBus, HandoverSummary } from "./events";
import type { SmsTransport } from "../sms/transport";

type Deps = { db: Database; events: EventBus };
type HandoverRow = typeof handovers.$inferSelect;

export const summaryOf = (row: HandoverRow, incidentId: string): HandoverSummary => ({
  id: row.id,
  hospitalId: row.hospitalId,
  incidentId,
  assessmentId: row.assessmentId,
  status: row.status,
  atmist: row.atmist,
  etaMin: (row.atmist as { etaMin?: number | null }).etaMin ?? null,
  createdAt: row.createdAt.toISOString(),
  smsFallbackSentAt: row.smsFallbackSentAt ? row.smsFallbackSentAt.toISOString() : null,
});

/** A medic may act on their own ambulance's bilans; the admin (demo operator) on any. */
function assertOwnsAssessment(appUser: AppUserContext, unitId: string | null) {
  if (appUser.role !== "admin" && (!appUser.unitId || appUser.unitId !== unitId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This bilan belongs to another ambulance" });
  }
}

/** Writes the AT-MIST from what was saved, with no network and nothing the client computed. */
async function snapshotFor(db: Database, assessment: typeof medicAssessments.$inferSelect, now: Date): Promise<AtMist> {
  const [incident] = await db.select().from(masterIncidents).where(eq(masterIncidents.id, assessment.incidentId));
  const [profile] = assessment.profileId
    ? await db.select().from(medicalProfiles).where(eq(medicalProfiles.id, assessment.profileId))
    : [];
  const [unit] = assessment.unitId
    ? await db.select().from(ambulanceUnits).where(eq(ambulanceUnits.id, assessment.unitId))
    : [];

  const age = profile ? ageYears(profile.birthDate, now) : assessment.estAge;
  const medications = profile?.medications ?? [];
  const index = shockIndex(assessment.hr, assessment.sbp, {
    ageYears: age,
    betaBlocker: medications.some((m) => m.class === "beta_blocker"),
    antihypertensive: medications.some((m) => m.class === "antihypertensive"),
    pregnant: (profile?.pregnancyStatus ?? "none") !== "none",
  });
  const vittelState = (assessment.vittel ?? {}) as Partial<VittelState>;
  const needs = deriveNeeds(
    needFacts({
      gcs: assessment.gcs,
      sbp: assessment.sbp,
      shockIndex: index?.value ?? null,
      ageYears: age,
      pregnant: (profile?.pregnancyStatus ?? "none") !== "none",
      injuries: assessment.suspectedInjuries,
      vittel: vittelState,
    }),
  );

  return buildAtMist({
    incidentAt: incident!.firstAlertAt,
    unit: unit?.callSign ?? "AMB",
    victimIndex: assessment.victimIndex,
    etaMin: assessment.etaMinutes,
    age,
    sex: assessment.sex ?? profile?.sex ?? null,
    vittel: evaluateVittel(vittelState),
    injuries: assessment.suspectedInjuries,
    treatments: assessment.treatments,
    vitals: assessment,
    shockIndex: index,
    needs: needs.required,
    // Only what the hospital must prepare for: the name, contact and profile code never leave the profile.
    profile: profile ? { bloodType: profile.bloodType, allergies: profile.allergies, medications } : null,
  });
}

/**
 * The medic confirms the destination: the hospital receives a frozen AT-MIST (PRD FR-S2-29, FR-S6-05).
 * Sending again to the same hospital while its answer is awaited gives back the same handover.
 */
export async function sendHandover({ db, events }: Deps, appUser: AppUserContext, assessmentId: string, now = new Date()) {
  const [assessment] = await db.select().from(medicAssessments).where(eq(medicAssessments.id, assessmentId));
  if (!assessment) throw new TRPCError({ code: "NOT_FOUND", message: "Bilan not found" });
  assertOwnsAssessment(appUser, assessment.unitId);
  if (!assessment.chosenHospitalId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choisissez d'abord l'hôpital de destination" });
  }
  const hospitalId = assessment.chosenHospitalId;

  const created = await db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(handovers)
      .where(and(eq(handovers.assessmentId, assessmentId), eq(handovers.hospitalId, hospitalId), eq(handovers.status, "pending")));
    if (pending) return { row: pending, isNew: false };

    const atmist = await snapshotFor(tx as unknown as Database, assessment, now);
    const [row] = await tx.insert(handovers).values({ assessmentId, hospitalId, atmist: atmist as unknown as Record<string, unknown> }).returning();
    await tx.insert(incidentEvents).values({
      incidentId: assessment.incidentId,
      actorRole: appUser.role,
      actorId: appUser.id,
      type: "handover.sent",
      payload: { handoverId: row!.id, hospitalId, assessmentId },
    });
    return { row: row!, isNew: true };
  });

  // Told only once the row is saved, so a hospital never hears of a handover that does not exist.
  if (created.isNew) {
    events.publish({ type: "handover.incoming", handover: summaryOf(created.row, assessment.incidentId) }, `hospital:${hospitalId}`);
  }
  const atmist = created.row.atmist as unknown as AtMist;
  return {
    handoverId: created.row.id,
    hospitalId,
    status: created.row.status,
    atmist,
    sms: renderAtMistSms(atmist),
  };
}

/** The hospital answers: accept, or divert with the specialty it cannot offer. Answered once. */
export async function respondToHandover(
  { db, events }: Deps,
  appUser: AppUserContext,
  input: { handoverId: string; decision: "accept" | "divert"; specialty?: Need },
  now = new Date(),
) {
  const [found] = await db
    .select({ handover: handovers, incidentId: medicAssessments.incidentId, unitId: medicAssessments.unitId })
    .from(handovers)
    .innerJoin(medicAssessments, eq(medicAssessments.id, handovers.assessmentId))
    .where(eq(handovers.id, input.handoverId));
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Handover not found" });
  if (appUser.role !== "admin" && appUser.hospitalId !== found.handover.hospitalId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This handover is for another hospital" });
  }
  if (input.decision === "divert" && !input.specialty) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Indiquez la spécialité qui ne peut pas être assurée" });
  }
  const status = input.decision === "accept" ? "accepted" : "diverted";
  const divertSpecialty = input.decision === "divert" ? input.specialty! : null;

  const answered = await db.transaction(async (tx) => {
    // Only a handover still waiting can be answered, even if two answers arrive together.
    const [row] = await tx
      .update(handovers)
      .set({ status, respondedAt: now, respondedBy: appUser.id, divertSpecialty })
      .where(and(eq(handovers.id, input.handoverId), eq(handovers.status, "pending")))
      .returning();
    if (!row) return null;

    // Divert automatically updates the hospital's specialty status to divert (PLAN.md 7.3)
    if (divertSpecialty) {
      const [hosp] = await tx.select().from(hospitalsMatrix).where(eq(hospitalsMatrix.id, row.hospitalId));
      if (hosp) {
        const current = (hosp.status ?? {}) as Record<string, "accept" | "divert">;
        const nextStatus = { ...current, [divertSpecialty]: "divert" as const };
        await tx
          .update(hospitalsMatrix)
          .set({ status: nextStatus, statusUpdatedAt: now, statusUpdatedBy: appUser.id })
          .where(eq(hospitalsMatrix.id, row.hospitalId));
      }
    }

    await tx.insert(incidentEvents).values({
      incidentId: found.incidentId,
      actorRole: appUser.role,
      actorId: appUser.id,
      type: `handover.${status}`,
      payload: { handoverId: row.id, hospitalId: row.hospitalId, specialty: divertSpecialty },
    });
    return row;
  });
  if (!answered) throw new TRPCError({ code: "CONFLICT", message: "Ce transfert a déjà reçu une réponse" });

  if (found.unitId) {
    events.publish(
      {
        type: "handover.updated",
        handoverId: answered.id,
        hospitalId: answered.hospitalId,
        status,
        divertSpecialty,
        respondedAt: now.toISOString(),
      },
      `unit:${found.unitId}`,
    );
  }
  return { handoverId: answered.id, status, divertSpecialty };
}

/** Sends AT-MIST via SMS if handover has not been acknowledged within 60 s (PRD FR-S3-22, FR-S7-03). */
export async function checkHandoverFallback(
  { db, events, smsTransport }: { db: Database; events: EventBus; smsTransport: SmsTransport },
  now = new Date(),
) {
  const threshold = new Date(now.getTime() - 60 * 1000);

  const pending = await db
    .select({
      handover: handovers,
      phone: hospitalsMatrix.phone,
      hospitalName: hospitalsMatrix.name,
      incidentId: medicAssessments.incidentId,
    })
    .from(handovers)
    .innerJoin(hospitalsMatrix, eq(hospitalsMatrix.id, handovers.hospitalId))
    .innerJoin(medicAssessments, eq(medicAssessments.id, handovers.assessmentId))
    .where(
      and(
        eq(handovers.status, "pending"),
        isNull(handovers.smsFallbackSentAt),
        lte(handovers.createdAt, threshold),
      ),
    );

  let fallbackSent = 0;
  for (const item of pending) {
    const atmist = item.handover.atmist as unknown as AtMist;
    const body = renderAtMistSms(atmist);
    const phone = item.phone || "021000000";

    if (smsTransport) {
      await smsTransport.send(phone, body, { incidentId: item.incidentId });
    }

    await db
      .update(handovers)
      .set({ smsFallbackSentAt: now })
      .where(eq(handovers.id, item.handover.id));

    await db.insert(incidentEvents).values({
      incidentId: item.incidentId,
      actorRole: "system",
      actorId: "system",
      type: "handover.sms_fallback_sent",
      payload: {
        handoverId: item.handover.id,
        hospitalId: item.handover.hospitalId,
        phone,
      },
    });

    // Notify the hospital board live so the card immediately shows "envoyé aussi par SMS"
    events.publish(
      {
        type: "handover.incoming",
        handover: {
          ...summaryOf(item.handover, item.incidentId),
          smsFallbackSentAt: now.toISOString(),
        },
      },
      `hospital:${item.handover.hospitalId}`,
    );

    fallbackSent++;
  }

  return { fallbackSent };
}

/** A hospital's handovers, newest first. `hospitalId` null means every hospital (admin only). */
export async function listIncoming(db: Database, hospitalId: string | null) {
  const rows = await db
    .select({ handover: handovers, incidentId: medicAssessments.incidentId })
    .from(handovers)
    .innerJoin(medicAssessments, eq(medicAssessments.id, handovers.assessmentId))
    .where(hospitalId ? eq(handovers.hospitalId, hospitalId) : undefined)
    .orderBy(desc(handovers.createdAt));
  return rows.map(({ handover, incidentId }) => ({
    ...summaryOf(handover, incidentId),
    respondedAt: handover.respondedAt,
    divertSpecialty: handover.divertSpecialty,
    smsFallbackSentAt: handover.smsFallbackSentAt ? handover.smsFallbackSentAt.toISOString() : null,
  }));
}

/** The handovers of one bilan, oldest first: what the tablet's En route screen shows. */
export async function listForAssessment(db: Database, appUser: AppUserContext, assessmentId: string) {
  const [assessment] = await db.select().from(medicAssessments).where(eq(medicAssessments.id, assessmentId));
  if (!assessment) throw new TRPCError({ code: "NOT_FOUND", message: "Bilan not found" });
  assertOwnsAssessment(appUser, assessment.unitId);
  const rows = await db.select().from(handovers).where(eq(handovers.assessmentId, assessmentId)).orderBy(asc(handovers.createdAt));
  return rows.map((row) => ({
    id: row.id,
    hospitalId: row.hospitalId,
    status: row.status,
    divertSpecialty: row.divertSpecialty,
    respondedAt: row.respondedAt,
    createdAt: row.createdAt,
    smsFallbackSentAt: row.smsFallbackSentAt ? row.smsFallbackSentAt.toISOString() : null,
  }));
}

export type UpdateVitalsInput = {
  assessmentId: string;
  vitals: {
    gcs?: number;
    hr?: number;
    sbp?: number;
    dbp?: number;
    spo2?: number;
    rr?: number;
  };
};

/** Pushes updated vital signs to active handovers and notifies the hospital board (PRD FR-S6-05, FR-S7-01). */
export async function updateHandoverVitals(
  { db, events }: Deps,
  appUser: AppUserContext,
  input: UpdateVitalsInput,
  now = new Date(),
) {
  const [assessment] = await db
    .select()
    .from(medicAssessments)
    .where(eq(medicAssessments.id, input.assessmentId));
  if (!assessment) throw new TRPCError({ code: "NOT_FOUND", message: "Bilan not found" });
  assertOwnsAssessment(appUser, assessment.unitId);

  const [profile] = assessment.profileId
    ? await db.select().from(medicalProfiles).where(eq(medicalProfiles.id, assessment.profileId))
    : [];

  const age = profile ? ageYears(profile.birthDate, now) : assessment.estAge;
  const medications = profile?.medications ?? [];
  const hr = input.vitals.hr ?? assessment.hr;
  const sbp = input.vitals.sbp ?? assessment.sbp;
  const dbp = input.vitals.dbp ?? assessment.dbp;
  const gcs = input.vitals.gcs ?? assessment.gcs;
  const spo2 = input.vitals.spo2 ?? assessment.spo2;
  const rr = input.vitals.rr ?? assessment.rr;

  const index = shockIndex(hr, sbp, {
    ageYears: age,
    betaBlocker: medications.some((m) => m.class === "beta_blocker"),
    antihypertensive: medications.some((m) => m.class === "antihypertensive"),
    pregnant: (profile?.pregnancyStatus ?? "none") !== "none",
  });

  await db
    .update(medicAssessments)
    .set({
      hr,
      sbp,
      dbp,
      gcs,
      spo2,
      rr,
      shockIndex: index?.value == null ? null : index.value.toFixed(2),
      assessedAt: now,
    })
    .where(eq(medicAssessments.id, input.assessmentId));

  const activeHandovers = await db
    .select()
    .from(handovers)
    .where(and(eq(handovers.assessmentId, input.assessmentId), notInArray(handovers.status, ["diverted"])));

  for (const h of activeHandovers) {
    const atmist = h.atmist as unknown as AtMist;
    const updatedAtmist: AtMist = {
      ...atmist,
      signs: {
        ...atmist.signs,
        gcs: gcs ?? null,
        hr: hr ?? null,
        sbp: sbp ?? null,
        dbp: dbp ?? null,
        spo2: spo2 ?? null,
        rr: rr ?? null,
        shockIndex: index ? { value: index.value, flag: index.flag, caveats: index.caveats } : null,
      },
    };

    await db
      .update(handovers)
      .set({ atmist: updatedAtmist as unknown as Record<string, unknown> })
      .where(eq(handovers.id, h.id));

    events.publish(
      {
        type: "handover.vitals_updated",
        handoverId: h.id,
        assessmentId: input.assessmentId,
        vitals: { gcs, hr, sbp, dbp, spo2, rr },
        shockIndex: index ? { value: index.value, flag: index.flag } : null,
        updatedAt: now.toISOString(),
      },
      `hospital:${h.hospitalId}`,
    );
  }

  await db.insert(incidentEvents).values({
    incidentId: assessment.incidentId,
    actorRole: appUser.role,
    actorId: appUser.id,
    type: "handover.vitals_updated",
    payload: {
      assessmentId: input.assessmentId,
      vitals: { gcs, hr, sbp, dbp, spo2, rr },
      shockIndex: index ? { value: index.value, flag: index.flag } : null,
    },
  });

  return {
    assessmentId: input.assessmentId,
    vitals: { gcs, hr, sbp, dbp, spo2, rr },
    shockIndex: index ? { value: index.value, flag: index.flag } : null,
    updatedAt: now.toISOString(),
  };
}

