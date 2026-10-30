import { createTestDb } from "@solvex-dergana/db/testing";
import {
  ambulanceUnits,
  hospitalsMatrix,
  masterIncidents,
  medicalProfiles,
} from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { t } from "../index";
import { createEventBus } from "../services/events";
import { appRouter } from "./index";

const ALL_CAPS = {
  capNeurosurgery: true,
  capCtScanner: true,
  capBurnUnit: true,
  capIcu: true,
  capTraumaSurgery: true,
  capPediatric: true,
  capObstetrics: true,
  capBloodBank: true,
};

async function setup() {
  const db = await createTestDb();
  const events = createEventBus();

  const [unit] = await db
    .insert(ambulanceUnits)
    .values({ callSign: "AMB-1", type: "ambulance_medicalisee", baseName: "Alger-Centre", lat: 36.77, lng: 3.06 })
    .returning();

  const place = { commune: "Alger", wilaya: "Alger", tier: "chu" as const };
  const [hospitalA, hospitalB] = await db
    .insert(hospitalsMatrix)
    .values([
      { ...place, name: "CHU Mustapha", shortName: "Mustapha", lat: 36.7614, lng: 3.0586, ...ALL_CAPS },
      {
        ...place,
        name: "EPH Bologhine",
        shortName: "Bologhine",
        lat: 36.79,
        lng: 3.04,
        ...ALL_CAPS,
        capNeurosurgery: false, // does NOT have neurosurgery
      },
    ])
    .returning();

  const [profile] = await db
    .insert(medicalProfiles)
    .values({
      shortCode: "AB12CD34",
      fullName: "Farid Test",
      birthDate: "1970-01-01",
      sex: "male",
      emergencyContact: "0555 12 34 56",
      consentAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();

  const [incident] = await db
    .insert(masterIncidents)
    .values({
      firstAlertAt: new Date("2026-10-30T09:02:00Z"),
      lastAlertAt: new Date("2026-10-30T09:02:00Z"),
      lat: 36.76,
      lng: 3.058,
      recSeverity: "red",
      linkedProfileIds: [profile!.id],
    })
    .returning();

  const as = (appUser: AppUserContext) =>
    t.createCallerFactory(appRouter)({ db, events, session: { user: { id: "auth" } }, appUser } as unknown as Context);

  const hospitalCallerA = as({ id: "hosp-a", role: "hospital", unitId: null, hospitalId: hospitalA!.id });
  const hospitalCallerB = as({ id: "hosp-b", role: "hospital", unitId: null, hospitalId: hospitalB!.id });
  const admin = as({ id: "admin-1", role: "admin", unitId: null, hospitalId: null });
  const medic = as({ id: "medic-1", role: "medic", unitId: unit!.id, hospitalId: null });

  return { db, events, hospitalCallerA, hospitalCallerB, admin, medic, hospitalA: hospitalA!, hospitalB: hospitalB!, incident: incident!, profile: profile! };
}

describe("hospitals.byId: hospital metadata and status", () => {
  it("returns the hospital metadata, capabilities, and accept/divert status", async () => {
    const { hospitalCallerA, hospitalA } = await setup();
    const result = await hospitalCallerA.hospitals.byId({ hospitalId: hospitalA.id });

    expect(result.id).toBe(hospitalA.id);
    expect(result.shortName).toBe("Mustapha");
    expect(result.capabilities.neurosurgery).toBe(true);
    expect(result.capabilities.ct_scanner).toBe(true);
    expect(result.status).toEqual({});
    expect(result.staleDivert).toBe(false);
  });
});

describe("hospitals.updateStatus: specialty toggles (PRD FR-S7-02)", () => {
  it("allows hospital staff to toggle a specialty to divert, recording who and when", async () => {
    const { db, hospitalCallerA, hospitalA } = await setup();
    const updated = await hospitalCallerA.hospitals.updateStatus({
      specialty: "neurosurgery",
      status: "divert",
    });

    expect(updated.status.neurosurgery).toBe("divert");
    expect(updated.statusUpdatedBy).toBe("hosp-a");
    expect(updated.statusUpdatedAt).toBeDefined();

    const [row] = await db.select().from(hospitalsMatrix).where(eq(hospitalsMatrix.id, hospitalA.id));
    expect(row!.status).toMatchObject({ neurosurgery: "divert" });
    expect(row!.statusUpdatedBy).toBe("hosp-a");
  });

  it("refuses updating a specialty for another hospital", async () => {
    const { hospitalCallerA, hospitalB } = await setup();
    const error = await hospitalCallerA.hospitals
      .updateStatus({
        hospitalId: hospitalB.id,
        specialty: "neurosurgery",
        status: "divert",
      })
      .catch((e) => e);

    expect(error.code).toBe("FORBIDDEN");
  });

  it("refuses toggling a specialty that the hospital does not have", async () => {
    const { hospitalCallerB } = await setup();
    // hospitalB does not have neurosurgery
    const error = await hospitalCallerB.hospitals
      .updateStatus({
        specialty: "neurosurgery",
        status: "divert",
      })
      .catch((e) => e);

    expect(error.code).toBe("BAD_REQUEST");
  });

  it("allows admin to update status for any hospital", async () => {
    const { admin, hospitalA } = await setup();
    const updated = await admin.hospitals.updateStatus({
      hospitalId: hospitalA.id,
      specialty: "ct_scanner",
      status: "divert",
    });

    expect(updated.status.ct_scanner).toBe("divert");
  });

  it("flags a divert status older than 6 hours as stale so the board asks for confirmation", async () => {
    const { db, hospitalCallerA, hospitalA } = await setup();
    const sevenHoursAgo = new Date(Date.now() - 7 * 3600 * 1000);
    await db
      .update(hospitalsMatrix)
      .set({
        status: { neurosurgery: "divert" },
        statusUpdatedAt: sevenHoursAgo,
        statusUpdatedBy: "past-user",
      })
      .where(eq(hospitalsMatrix.id, hospitalA.id));

    const result = await hospitalCallerA.hospitals.byId({ hospitalId: hospitalA.id });
    expect(result.staleDivert).toBe(true);
  });

  it("immediately affects tablet rankings when a specialty is diverted", async () => {
    const { hospitalCallerA, medic, incident, profile, hospitalA } = await setup();
    await hospitalCallerA.hospitals.updateStatus({
      specialty: "neurosurgery",
      status: "divert",
    });

    const saved = await medic.assessments.save({
      incidentId: incident.id,
      profileId: profile.id,
      hr: 110,
      sbp: 120,
      gcs: 8, // severe head trauma -> needs neurosurgery
      suspectedInjuries: ["Tête"],
    });

    expect(saved.recommendation?.ranking).toBeDefined();
    const matchA = saved.recommendation!.ranking.find((r) => r.hospitalId === hospitalA.id);
    expect(matchA?.diverting).toContain("neurosurgery");
  });
});
