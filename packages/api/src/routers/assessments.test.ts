import { createTestDb } from "@solvex-dergana/db/testing";
import {
  ambulanceUnits,
  masterIncidents,
  medicalProfiles,
  medicAssessments,
} from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { t } from "../index";
import { assessmentsRouter } from "./assessments";

async function setup(role: AppUserContext["role"] = "medic", unit: "mine" | "none" = "mine") {
  const db = await createTestDb();
  const [mine, other] = await db
    .insert(ambulanceUnits)
    .values([
      { callSign: "AMB-1", type: "ambulance_medicalisee", baseName: "Alger-Centre", lat: 36.77, lng: 3.06 },
      { callSign: "AMB-2", type: "ambulance_medicalisee", baseName: "Rouiba", lat: 36.74, lng: 3.28 },
    ])
    .returning();
  const [incident] = await db
    .insert(masterIncidents)
    .values({
      firstAlertAt: new Date("2026-10-30T10:00:00Z"),
      lastAlertAt: new Date("2026-10-30T10:00:00Z"),
      vittelPrefill: { l2: { rollover: { value: true, source: "iot" } } },
    })
    .returning();
  const [profile] = await db
    .insert(medicalProfiles)
    .values({
      shortCode: "AB12CD34",
      fullName: "Karim Test",
      birthDate: "1950-01-01",
      sex: "male",
      medications: [
        { name: "Sintrom", class: "anticoagulant" },
        { name: "Bisoprolol", class: "beta_blocker" },
      ],
      consentAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  const appUser: AppUserContext = { id: "u1", role, unitId: unit === "mine" ? mine!.id : null, hospitalId: null };
  const caller = t.createCallerFactory(assessmentsRouter)({
    db,
    session: { user: { id: "auth-1" } },
    appUser,
  } as unknown as Context);
  return { db, caller, unit: mine!, otherUnit: other!, incident: incident!, profile: profile! };
}

describe("assessments.save: the server recomputes everything", () => {
  it("computes the Shock Index from the vitals and stores it", async () => {
    const { db, caller, incident } = await setup();
    const result = await caller.save({ incidentId: incident.id, hr: 130, sbp: 100, gcs: 15, spo2: 97 });
    expect(result.shockIndex).toEqual({ value: 1.3, flag: "critical", caveats: [] });
    const [row] = await db.select().from(medicAssessments).where(eq(medicAssessments.id, result.assessmentId));
    expect(row!.shockIndex).toBe("1.30");
    expect(row!.hr).toBe(130);
  });

  it("ignores a Shock Index or verdict sent by the client", async () => {
    const { caller, incident } = await setup();
    const forged = { incidentId: incident.id, hr: 60, sbp: 120, shockIndex: 3.5, severe: true } as never;
    const result = await caller.save(forged);
    expect(result.shockIndex).toEqual({ value: 0.5, flag: "normal", caveats: [] });
    expect(result.vittel.positives.map((p) => p.id)).toEqual(["rollover"]); // from the sensor prefill only
  });

  it("stores no Shock Index when the heart rate or the pressure is missing", async () => {
    const { db, caller, incident } = await setup();
    const result = await caller.save({ incidentId: incident.id, hr: 90 });
    expect(result.shockIndex).toBeNull();
    const [row] = await db.select().from(medicAssessments);
    expect(row!.shockIndex).toBeNull();
  });

  it("marks the victim severe from the measured vitals", async () => {
    const { caller, incident } = await setup();
    const result = await caller.save({ incidentId: incident.id, gcs: 12, sbp: 85, spo2: 95 });
    expect(result.vittel.severe).toBe(true);
    expect(result.vittel.positives.map((p) => p.id)).toEqual(["gcsLow", "sbpLow", "rollover"]);
  });

  it("takes level 5 and the caveats from the linked profile", async () => {
    const { db, caller, incident, profile } = await setup();
    const result = await caller.save({ incidentId: incident.id, profileId: profile.id, hr: 80, sbp: 120 });
    expect(result.vittel.positives).toContainEqual(
      expect.objectContaining({ id: "coagulationDisorder", source: "app" }),
    );
    expect(result.vittel.positives).toContainEqual(expect.objectContaining({ id: "ageOver65" }));
    expect(result.shockIndex!.caveats).toEqual(["peut sous-estimer le choc"]);
    const [row] = await db.select().from(medicAssessments);
    expect(row!.profileId).toBe(profile.id);
  });

  it("uses the estimated age and sex when the victim has no profile", async () => {
    const { caller, incident } = await setup();
    const child = await caller.save({ incidentId: incident.id, estAge: 8, sex: "female", hr: 110, sbp: 100 });
    expect(child.shockIndex!.caveats).toEqual(["seuils adultes non applicables"]);
    const elder = await caller.save({ incidentId: incident.id, victimIndex: 2, estAge: 80, hr: 80, sbp: 120 });
    expect(elder.vittel.positives.map((p) => p.id)).toContain("ageOver65");
  });

  it("lets the medic overrule the sensor prefill, and keeps what they ticked", async () => {
    const { db, caller, incident } = await setup();
    await caller.save({
      incidentId: incident.id,
      vittel: {
        l2: { rollover: { value: false, source: "medic" } },
        l3: { flailChest: { value: true, source: "medic" } },
      },
      suspectedInjuries: ["thorax"],
      treatments: ["oxygène"],
    });
    const [row] = await db.select().from(medicAssessments);
    expect(row!.vittel!.l2!.rollover).toEqual({ value: false, source: "medic" });
    expect(row!.vittel!.l3!.flailChest).toEqual({ value: true, source: "medic" });
    expect(row!.suspectedInjuries).toEqual(["thorax"]);
    expect(row!.treatments).toEqual(["oxygène"]);
  });

  it("stores whatever the client claims as the medic's own answer, and drops criteria that are not on the list", async () => {
    const { db, caller, incident } = await setup();
    await caller.save({
      incidentId: incident.id,
      vittel: { l3: { flailChest: { value: true, source: "iot" }, madeUp: { value: true, source: "medic" } } },
    });
    const [row] = await db.select().from(medicAssessments);
    expect(row!.vittel!.l3).toEqual({ flailChest: { value: true, source: "medic" } });
  });

  it("saving the same victim again updates the record; another victim gets its own", async () => {
    const { db, caller, incident } = await setup();
    const first = await caller.save({ incidentId: incident.id, hr: 80, sbp: 120 });
    const again = await caller.save({ incidentId: incident.id, hr: 100, sbp: 110 });
    const second = await caller.save({ incidentId: incident.id, victimIndex: 2, hr: 70, sbp: 120 });
    expect(again.assessmentId).toBe(first.assessmentId);
    expect(second.assessmentId).not.toBe(first.assessmentId);
    const rows = await db.select().from(medicAssessments);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.assessmentId)!.hr).toBe(100);
  });

  it("refuses measures that cannot be real", async () => {
    const { caller, incident } = await setup();
    await expect(caller.save({ incidentId: incident.id, gcs: 20 })).rejects.toThrow();
    await expect(caller.save({ incidentId: incident.id, gcs: 2 })).rejects.toThrow();
    await expect(caller.save({ incidentId: incident.id, spo2: 101 })).rejects.toThrow();
    await expect(caller.save({ incidentId: incident.id, hr: -1 })).rejects.toThrow();
  });

  it("says so when the incident or the profile does not exist", async () => {
    const { caller, incident } = await setup();
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(caller.save({ incidentId: missing })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.save({ incidentId: incident.id, profileId: missing })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("assessments.save: who may save", () => {
  it("is refused to a dispatcher", async () => {
    const { caller, incident } = await setup("dispatcher");
    await expect(caller.save({ incidentId: incident.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is refused to a medic with no ambulance", async () => {
    const { caller, incident } = await setup("medic", "none");
    await expect(caller.save({ incidentId: incident.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is refused to a medic asking to save for another ambulance", async () => {
    const { caller, incident, otherUnit } = await setup();
    await expect(caller.save({ incidentId: incident.id, unitId: otherUnit.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("records the medic's own ambulance", async () => {
    const { db, caller, incident, unit } = await setup();
    await caller.save({ incidentId: incident.id });
    const [row] = await db.select().from(medicAssessments);
    expect(row!.unitId).toBe(unit.id);
  });

  it("lets the admin (demo operator) save for any ambulance", async () => {
    const { db, caller, incident, otherUnit } = await setup("admin", "none");
    await caller.save({ incidentId: incident.id, unitId: otherUnit.id });
    const [row] = await db.select().from(medicAssessments);
    expect(row!.unitId).toBe(otherUnit.id);
  });
});

describe("assessments.openIncidents and assessments.mission: what the bilan screen reads", () => {
  it("lists the incidents still in progress, not the closed ones or false alarms", async () => {
    const { db, caller, incident } = await setup();
    await db.insert(masterIncidents).values([
      { firstAlertAt: new Date(), lastAlertAt: new Date(), status: "closed" },
      { firstAlertAt: new Date(), lastAlertAt: new Date(), status: "false_alarm" },
      { firstAlertAt: new Date(), lastAlertAt: new Date(), status: "on_scene", recSeverity: "red" },
    ]);
    const list = await caller.openIncidents();
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.id)).toContain(incident.id);
    expect(list.every((i) => ["open", "on_scene"].includes(i.status))).toBe(true);
  });

  it("gives the incident, the linked profiles without contact data, and only this ambulance's victims", async () => {
    const { db, caller, incident, profile, unit, otherUnit } = await setup();
    await db.update(masterIncidents).set({ linkedProfileIds: [profile.id] }).where(eq(masterIncidents.id, incident.id));
    await db.insert(medicAssessments).values([
      { incidentId: incident.id, unitId: unit.id, victimIndex: 1 },
      { incidentId: incident.id, unitId: otherUnit.id, victimIndex: 1 },
    ]);
    const mission = await caller.mission({ incidentId: incident.id });
    expect(mission.incident.id).toBe(incident.id);
    expect(mission.incident.vittelPrefill).toEqual({ l2: { rollover: { value: true, source: "iot" } } });
    expect(mission.profiles).toHaveLength(1);
    expect(mission.profiles[0]).toMatchObject({ id: profile.id, fullName: "Karim Test", sex: "male" });
    expect(mission.profiles[0]!.ageYears).toBeGreaterThan(70);
    expect(mission.profiles[0]).not.toHaveProperty("emergencyContact");
    expect(mission.profiles[0]).not.toHaveProperty("shortCode");
    expect(mission.assessments).toHaveLength(1);
    expect(mission.assessments[0]!.unitId).toBe(unit.id);
  });

  it("says so when the incident does not exist, and is closed to a hospital login", async () => {
    const { caller } = await setup();
    await expect(caller.mission({ incidentId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const { caller: hospital } = await setup("hospital");
    await expect(hospital.openIncidents()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
