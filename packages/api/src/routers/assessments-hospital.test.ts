import { createTestDb } from "@solvex-dergana/db/testing";
import { ambulanceUnits, hospitalsMatrix, masterIncidents, medicAssessments, zones } from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { t } from "../index";
import { assessmentsRouter } from "./assessments";

const ALL_CAPS = {
  capNeurosurgery: true, capCtScanner: true, capBurnUnit: true, capIcu: true,
  capTraumaSurgery: true, capPediatric: true, capObstetrics: true, capBloodBank: true,
};

// A scene at Alger-Centre and three hospitals: one close with everything, one far with everything,
// one close but without an ICU.
async function setup(options: { position?: boolean; role?: AppUserContext["role"] } = {}) {
  const db = await createTestDb();
  const [unit] = await db
    .insert(ambulanceUnits)
    .values({ callSign: "AMB-1", type: "ambulance_medicalisee", baseName: "Alger-Centre", lat: 36.77, lng: 3.06 })
    .returning();
  const [incident] = await db
    .insert(masterIncidents)
    .values({
      firstAlertAt: new Date("2026-10-30T10:00:00Z"),
      lastAlertAt: new Date("2026-10-30T10:00:00Z"),
      lat: options.position === false ? null : 36.7538,
      lng: options.position === false ? null : 3.0588,
      recSeverity: "red",
    })
    .returning();
  const place = { commune: "Alger", wilaya: "Alger", tier: "chu" as const };
  const [near, far, noIcu] = await db
    .insert(hospitalsMatrix)
    .values([
      { ...place, name: "CHU Proche", shortName: "Proche", lat: 36.7614, lng: 3.0586, ...ALL_CAPS },
      { ...place, name: "EPH Lointain", shortName: "Lointain", lat: 36.738, lng: 3.28, ...ALL_CAPS },
      { ...place, name: "EHS Sans Réa", shortName: "Sans réa", lat: 36.7655, lng: 3.051, ...ALL_CAPS, capIcu: false },
    ])
    .returning();
  const appUser: AppUserContext = { id: "u1", role: options.role ?? "medic", unitId: unit!.id, hospitalId: null };
  const caller = t.createCallerFactory(assessmentsRouter)({
    db, session: { user: { id: "auth-1" } }, appUser,
  } as unknown as Context);
  return { db, caller, incident: incident!, near: near!, far: far!, noIcu: noIcu! };
}

const SHOCK = { hr: 130, sbp: 85 }; // needs trauma surgery, blood bank and an ICU

describe("assessments.save: the hospital recommendation", () => {
  it("ranks the hospitals on the server, stores the ranking and the recommended hospital", async () => {
    const { db, caller, incident, near, far, noIcu } = await setup();
    const result = await caller.save({ incidentId: incident.id, ...SHOCK });
    expect(result.recommendation!.recommended!.hospitalId).toBe(near.id);
    // The nearest hospital without an ICU is penalised 30 minutes, so it ranks below the far one that has everything.
    expect(result.recommendation!.ranking.map((m) => m.hospitalId)).toEqual([near.id, far.id, noIcu.id]);
    const [row] = await db.select().from(medicAssessments).where(eq(medicAssessments.id, result.assessmentId));
    expect(row!.recHospitalId).toBe(near.id);
    expect(row!.recRanking).toHaveLength(3);
    expect(row!.recRanking![0]).toMatchObject({ hospitalId: near.id, etaSource: "road", missing: [] });
    expect(row!.recRanking![2]!.missing).toEqual(["icu"]);
    expect(row!.etaMinutes).toBeGreaterThan(0);
  });

  it("derives the needs from the bilan: a calm victim with nothing wrong needs nothing in particular", async () => {
    const { caller, incident, noIcu } = await setup();
    const result = await caller.save({ incidentId: incident.id, hr: 70, sbp: 120, gcs: 15 });
    expect(result.recommendation!.needs.required).toEqual([]);
    expect(result.recommendation!.ranking.find((m) => m.hospitalId === noIcu.id)!.missing).toEqual([]);
  });

  it("reads a hospital's divert status when ranking", async () => {
    const { db, caller, incident, near, far } = await setup();
    await db.update(hospitalsMatrix).set({ status: { icu: "divert" } }).where(eq(hospitalsMatrix.id, near.id));
    const result = await caller.save({ incidentId: incident.id, ...SHOCK });
    expect(result.recommendation!.recommended!.hospitalId).toBe(far.id);
    expect(result.recommendation!.ranking.find((m) => m.hospitalId === near.id)!.diverting).toEqual(["icu"]);
  });

  it("never recommends a polyclinic for a red incident, even when it is the closest to the scene", async () => {
    const { db, caller, incident } = await setup();
    const [poly] = await db
      .insert(hospitalsMatrix)
      .values({
        name: "Polyclinique Centre", shortName: "Poly", tier: "epsp_polyclinic", commune: "Alger", wilaya: "Alger",
        lat: 36.7539, lng: 3.0589, capStabilizationOnly: true,
      })
      .returning();
    const result = await caller.save({ incidentId: incident.id, hr: 70, sbp: 120 });
    expect(result.recommendation!.recommended!.hospitalId).not.toBe(poly!.id);
    expect(result.recommendation!.ranking.at(-1)!.hospitalId).toBe(poly!.id);
  });

  it("recommends nothing when the incident has no position yet, and still saves the bilan", async () => {
    const { db, caller, incident } = await setup({ position: false });
    const result = await caller.save({ incidentId: incident.id, ...SHOCK });
    expect(result.recommendation).toBeNull();
    const [row] = await db.select().from(medicAssessments);
    expect(row!.recHospitalId).toBeNull();
    expect(row!.recRanking).toBeNull();
  });

  it("recomputes the recommendation when the same victim is saved again", async () => {
    const { caller, incident, near, far } = await setup();
    const calm = await caller.save({ incidentId: incident.id, hr: 70, sbp: 120 });
    // With no particular need every hospital qualifies, so the shortest road time wins.
    const times = calm.recommendation!.ranking.map((m) => m.etaMin);
    expect(calm.recommendation!.recommended!.etaMin).toBe(Math.min(...times));
    expect(calm.recommendation!.needs.required).toEqual([]);
    const shocked = await caller.save({ incidentId: incident.id, ...SHOCK });
    expect(shocked.recommendation!.needs.required).toContain("icu");
    expect(shocked.recommendation!.recommended!.hospitalId).toBe(near.id);
    expect(shocked.recommendation!.ranking.map((m) => m.hospitalId)).toContain(far.id);
  });
});

describe("assessments.save: the medic's choice", () => {
  it("stores the choice, with no reason needed when it is the recommended hospital", async () => {
    const { db, caller, incident, near } = await setup();
    const result = await caller.save({ incidentId: incident.id, ...SHOCK, chosenHospitalId: near.id, overrideReason: "pas besoin" });
    const [row] = await db.select().from(medicAssessments).where(eq(medicAssessments.id, result.assessmentId));
    expect(row!.chosenHospitalId).toBe(near.id);
    expect(row!.overrideReason).toBeNull();
    expect(row!.recHospitalId).toBe(near.id);
    expect(row!.etaMinutes).toBeCloseTo(result.recommendation!.recommended!.etaMin, 6);
  });

  it("refuses another hospital without a reason, and with a blank one", async () => {
    const { caller, incident, far } = await setup();
    await expect(caller.save({ incidentId: incident.id, ...SHOCK, chosenHospitalId: far.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.save({ incidentId: incident.id, ...SHOCK, chosenHospitalId: far.id, overrideReason: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("stores another hospital together with the reason, and the time to that hospital", async () => {
    const { db, caller, incident, near, far } = await setup();
    const result = await caller.save({
      incidentId: incident.id, ...SHOCK, chosenHospitalId: far.id, overrideReason: "Famille sur place à Rouiba",
    });
    const [row] = await db.select().from(medicAssessments).where(eq(medicAssessments.id, result.assessmentId));
    expect(row!.chosenHospitalId).toBe(far.id);
    expect(row!.recHospitalId).toBe(near.id); // the recommendation is kept next to the decision
    expect(row!.overrideReason).toBe("Famille sur place à Rouiba");
    expect(row!.etaMinutes).toBeCloseTo(result.recommendation!.ranking.find((m) => m.hospitalId === far.id)!.etaMin, 6);
  });

  it("says so when the chosen hospital does not exist", async () => {
    const { caller, incident } = await setup();
    await expect(
      caller.save({ incidentId: incident.id, ...SHOCK, chosenHospitalId: "00000000-0000-4000-8000-000000000000", overrideReason: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a hospital be chosen when there is no recommendation to disagree with", async () => {
    const { db, caller, incident, far } = await setup({ position: false });
    await caller.save({ incidentId: incident.id, ...SHOCK, chosenHospitalId: far.id });
    const [row] = await db.select().from(medicAssessments);
    expect(row!.chosenHospitalId).toBe(far.id);
    expect(row!.overrideReason).toBeNull();
  });
});

describe("assessments.orientationData: what the tablet caches to rank hospitals offline", () => {
  it("gives every hospital with its capabilities, position and status, and the city zones", async () => {
    const { db, caller } = await setup();
    await db.insert(zones).values({
      name: "Alger-Centre",
      polygon: { type: "Polygon", coordinates: [[[3.0, 36.7], [3.1, 36.7], [3.1, 36.8], [3.0, 36.8], [3.0, 36.7]]] },
    });
    const data = await caller.orientationData();
    expect(data.hospitals).toHaveLength(3);
    expect(data.hospitals.find((h) => h.shortName === "Sans réa")).toMatchObject({ capIcu: false, tier: "chu", status: {} });
    expect(data.zones).toHaveLength(1);
    expect(data.zones[0]).toMatchObject({ type: "Polygon" });
  });

  it("is closed to a hospital login", async () => {
    const { caller } = await setup({ role: "hospital" });
    await expect(caller.orientationData()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
