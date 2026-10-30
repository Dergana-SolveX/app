import { ambulanceUnits, appUsers, masterIncidents, medicalProfiles } from "@solvex-dergana/db/schema/index";
import { createTestDb } from "@solvex-dergana/db/testing";
import { encodeSvx, type SvxAlert } from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { t } from "../index";
import { createEventBus } from "../services/events";
import { ingestSms } from "../services/ingest";
import { listIncidentEvents } from "../services/incidents";
import { dispatchRouter } from "./dispatch";

/** A fire at Bab Ezzouar: red, and the triage recommends one medicalised ambulance. */
const fireAtBabEzzouar: SvxAlert = {
  layer: 2,
  geohash: "snd2bmtf",
  eventMinutes: Math.floor(Date.now() / 60_000),
  peakG: null,
  rollover: null,
  fire: true,
  victims: 2,
  conscious: 1,
  trapped: false,
  bleeding: false,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
};

// Real places around Bab Ezzouar (36.7255, 3.1836): El Harrach is about 4 km away, Rouiba about 9 km,
// Alger-Centre about 12 km.
const EL_HARRACH_MED = { callSign: "EH-MED", type: "ambulance_medicalisee", baseName: "El Harrach", lat: 36.7197, lng: 3.1347 } as const;
const ROUIBA_VSAV = { callSign: "ROU-VSAV", type: "vsav_standard", baseName: "Rouiba", lat: 36.7381, lng: 3.28 } as const;
const ALGER_MED = { callSign: "ALG-MED", type: "ambulance_medicalisee", baseName: "Alger-Centre", lat: 36.7733, lng: 3.0588 } as const;

const appUser = (role: AppUserContext["role"], unitId: string | null = null): AppUserContext => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  role,
  unitId,
  hospitalId: null,
});

async function setup(role: AppUserContext["role"] = "dispatcher") {
  const db = await createTestDb();
  const events = createEventBus();
  /** The router as seen by one logged-in user. */
  const as = (user: AppUserContext) =>
    t.createCallerFactory(dispatchRouter)({
      db,
      events,
      session: { user: { id: "auth-1" } },
      appUser: user,
    } as unknown as Context);
  const dispatch = as(appUser(role));
  const addUnits = async (...units: (typeof ambulanceUnits.$inferInsert)[]) =>
    db.insert(ambulanceUnits).values(units).returning();
  const report = async (alert: SvxAlert = fireAtBabEzzouar, from = "+213550000001") => {
    const result = await ingestSms({ db, events }, { from, body: encodeSvx(alert), emulated: true });
    if (result.kind !== "alert") throw new Error("expected an alert");
    return result.incidentId;
  };
  return { db, events, dispatch, as, addUnits, report, journal: (incidentId: string) => listIncidentEvents(db, incidentId) };
}

describe("dispatch.recommendation (the dispatch form prefill)", () => {
  it("offers the available units nearest first, and prefills the nearest unit of the recommended type", async () => {
    const { dispatch, addUnits, report } = await setup();
    const [alger, rouiba, harrach] = await addUnits(ALGER_MED, ROUIBA_VSAV, EL_HARRACH_MED);
    const incidentId = await report();

    const form = await dispatch.recommendation({ incidentId });

    expect(form.recommended).toMatchObject([{ type: "ambulance_medicalisee", count: 1 }]);
    expect(form.candidates.map((unit) => unit.callSign)).toEqual(["EH-MED", "ROU-VSAV", "ALG-MED"]);
    expect(form.candidates[0]!.distanceM).toBeGreaterThan(3_000);
    expect(form.candidates[0]!.distanceM).toBeLessThan(6_000);
    expect(form.prefill).toEqual([harrach!.id]); // the nearest medicalised ambulance, not the nearer VSAV
    expect(form.candidates.map((unit) => unit.id)).toEqual([harrach!.id, rouiba!.id, alger!.id]);
    expect(form.notice).toBeNull();
  });

  it("explains when no medicalised ambulance is available and suggests the nearest VSAV right now", async () => {
    const { dispatch, addUnits, report } = await setup();
    const [, vsav] = await addUnits({ ...EL_HARRACH_MED, available: false }, ROUIBA_VSAV);
    const incidentId = await report();

    const form = await dispatch.recommendation({ incidentId });

    expect(form.candidates.map((unit) => unit.callSign)).toEqual(["ROU-VSAV"]); // the unavailable one is not offered
    expect(form.prefill).toEqual([vsav!.id]);
    expect(form.notice).toMatch(/aucune ambulance médicalisée disponible/i);
    expect(form.notice).toMatch(/VSAV/);
  });
});

describe("dispatch.approve", () => {
  it("approves the recommendation as it is without a reason: the incident is dispatched and the decision is on record", async () => {
    const { dispatch, addUnits, report, journal } = await setup();
    const [harrach] = await addUnits(EL_HARRACH_MED, ROUIBA_VSAV);
    const incidentId = await report();
    const form = await dispatch.recommendation({ incidentId });

    const { dispatch: stored } = await dispatch.approve({
      incidentId,
      expectedVersion: form.version,
      unitIds: form.prefill,
    });

    expect(stored).toMatchObject({ incidentId, modified: false, modificationReason: null, unitIds: [harrach!.id] });
    expect(stored.recommended).toMatchObject({ units: [{ type: "ambulance_medicalisee", count: 1 }] });
    expect(stored.decided).toMatchObject({ unitIds: [harrach!.id] });

    expect((await dispatch.recommendation({ incidentId })).status).toBe("dispatched");

    const events = await journal(incidentId);
    expect(events.map((e) => e.type)).toContain("dispatch.approved");
    expect(events.find((e) => e.type === "dispatch.approved")).toMatchObject({ actorRole: "dispatcher" });
  });
});

describe("dispatch.approve: modifying the recommendation", () => {
  it("refuses a dispatch that differs from the recommendation until a reason is given", async () => {
    const { dispatch, addUnits, report } = await setup();
    const [, rouiba] = await addUnits(EL_HARRACH_MED, ROUIBA_VSAV);
    const incidentId = await report();
    const { version } = await dispatch.recommendation({ incidentId });

    // The triage recommends a medicalised ambulance; the dispatcher picks a VSAV instead.
    await expect(dispatch.approve({ incidentId, expectedVersion: version, unitIds: [rouiba!.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/motif/i),
    });
    await expect(
      dispatch.approve({ incidentId, expectedVersion: version, unitIds: [rouiba!.id], reason: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await dispatch.recommendation({ incidentId })).status).toBe("open"); // nothing was written

    const { dispatch: stored } = await dispatch.approve({
      incidentId,
      expectedVersion: version,
      unitIds: [rouiba!.id],
      reason: "Ambulance médicalisée à la maintenance",
    });
    expect(stored).toMatchObject({ modified: true, modificationReason: "Ambulance médicalisée à la maintenance" });
    // What was recommended is kept as it was, next to what was decided.
    expect(stored.recommended).toMatchObject({ units: [{ type: "ambulance_medicalisee", count: 1 }] });
    expect(stored.decided).toMatchObject({ unitIds: [rouiba!.id] });
  });

  it("logs a modification to the journal under its own type, with the reason", async () => {
    const { dispatch, addUnits, report, journal } = await setup();
    const [, rouiba] = await addUnits(EL_HARRACH_MED, ROUIBA_VSAV);
    const incidentId = await report();
    const { version } = await dispatch.recommendation({ incidentId });

    await dispatch.approve({ incidentId, expectedVersion: version, unitIds: [rouiba!.id], reason: "Plus proche" });

    const event = (await journal(incidentId)).find((e) => e.type === "dispatch.modified");
    expect(event?.payload).toMatchObject({ modified: true, reason: "Plus proche" });
  });

  it("refuses units that do not exist, are unavailable, or are listed twice", async () => {
    const { dispatch, addUnits, report } = await setup();
    const [harrach, busy] = await addUnits(EL_HARRACH_MED, { ...ALGER_MED, available: false });
    const incidentId = await report();
    const { version } = await dispatch.recommendation({ incidentId });
    const base = { incidentId, expectedVersion: version, reason: "test" };

    await expect(dispatch.approve({ ...base, unitIds: [busy!.id] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      dispatch.approve({ ...base, unitIds: ["00000000-0000-4000-8000-0000000000ff"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(dispatch.approve({ ...base, unitIds: [harrach!.id, harrach!.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("dispatch.recommendation: once the incident is dispatched", () => {
  it("shows the decision: who sent which units, whether it was modified, and why", async () => {
    const { db, as, addUnits, report } = await setup();
    const [karim] = await db.insert(appUsers).values({ name: "Karim Dispatcher", role: "dispatcher" }).returning();
    const [, rouiba] = await addUnits(EL_HARRACH_MED, ROUIBA_VSAV);
    const incidentId = await report();
    const asKarim = as({ ...appUser("dispatcher"), id: karim!.id });
    const before = await asKarim.recommendation({ incidentId });
    expect(before.decision).toBeNull();

    await asKarim.approve({
      incidentId,
      expectedVersion: before.version,
      unitIds: [rouiba!.id],
      reason: "Plus proche",
      notes: "Accès par la voie rapide",
    });

    const { decision } = await asKarim.recommendation({ incidentId });
    expect(decision).toMatchObject({
      dispatcherName: "Karim Dispatcher",
      modified: true,
      reason: "Plus proche",
      notes: "Accès par la voie rapide",
      units: [{ callSign: "ROU-VSAV", type: "vsav_standard" }],
    });
  });
});

describe("dispatch.approve: two dispatchers", () => {
  it("tells the second approver who already handled the incident", async () => {
    const { db, as, addUnits, report, journal } = await setup();
    const [first, second] = await db
      .insert(appUsers)
      .values([
        { name: "Karim Dispatcher", role: "dispatcher" },
        { name: "Samia Dispatcher", role: "dispatcher" },
      ])
      .returning();
    const [harrach] = await addUnits(EL_HARRACH_MED);
    const incidentId = await report();
    const asKarim = as({ ...appUser("dispatcher"), id: first!.id });
    const asSamia = as({ ...appUser("dispatcher"), id: second!.id });
    const { version } = await asKarim.recommendation({ incidentId });

    await asKarim.approve({ incidentId, expectedVersion: version, unitIds: [harrach!.id] });

    await expect(
      asSamia.approve({ incidentId, expectedVersion: version, unitIds: [harrach!.id] }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/déjà traité par Karim Dispatcher/i) });
    expect((await journal(incidentId)).filter((e) => e.type.startsWith("dispatch."))).toHaveLength(1); // only the first decision exists
  });

  it("refuses a form that was loaded before the incident changed", async () => {
    const { dispatch, addUnits, report } = await setup();
    const [harrach] = await addUnits(EL_HARRACH_MED);
    const incidentId = await report();
    const { version } = await dispatch.recommendation({ incidentId });

    await expect(
      dispatch.approve({ incidentId, expectedVersion: version - 1, unitIds: [harrach!.id] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("dispatch: who may use it", () => {
  it("is for dispatchers and the admin only", async () => {
    for (const role of ["medic", "hospital"] as const) {
      const { dispatch } = await setup(role);
      const incidentId = "00000000-0000-4000-8000-0000000000ee";
      await expect(dispatch.recommendation({ incidentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        dispatch.approve({ incidentId, expectedVersion: 1, unitIds: [incidentId] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

/** A stream item as the server-side caller sees it: a `[id, event]` envelope made by `tracked()`. */
const eventOf = (item: unknown) => (item as [string, { type: string } & Record<string, unknown>])[1];
const quiet = (ms = 150) => new Promise<"quiet">((resolve) => setTimeout(() => resolve("quiet"), ms));

describe("dispatch.onUnit (the ambulance's live channel)", () => {
  it("delivers the assignment to the dispatched unit's medic, and to nobody else", async () => {
    const { as, dispatch, addUnits, report } = await setup();
    const [harrach, rouiba] = await addUnits(EL_HARRACH_MED, ROUIBA_VSAV);
    const incidentId = await report();
    const listen = async (unit: typeof harrach) => {
      const stream = (await as(appUser("medic", unit!.id)).onUnit({ unitId: unit!.id }))[Symbol.asyncIterator]();
      expect(eventOf((await stream.next()).value)).toMatchObject({ type: "ready" });
      return stream;
    };
    const assigned = await listen(harrach);
    const other = await listen(rouiba);

    const { version } = await dispatch.recommendation({ incidentId });
    await dispatch.approve({ incidentId, expectedVersion: version, unitIds: [harrach!.id], notes: "Accès par la voie rapide" });

    expect(eventOf((await assigned.next()).value)).toMatchObject({
      type: "dispatch.assigned",
      incidentId,
      unitId: harrach!.id,
      notes: "Accès par la voie rapide",
    });
    expect(await Promise.race([other.next(), quiet()])).toBe("quiet");
    await assigned.return?.(undefined);
    // `other` still has a read pending (that is how we know it stayed quiet), so it is left to be collected.
  });

  it("lets a medic listen to their own ambulance only (the admin may listen to any)", async () => {
    const { as, addUnits } = await setup();
    const [harrach, rouiba] = await addUnits(EL_HARRACH_MED, ROUIBA_VSAV);
    const firstEvent = async (user: AppUserContext, unitId: string) =>
      (await (await as(user).onUnit({ unitId }))[Symbol.asyncIterator]().next()).value;

    await expect(firstEvent(appUser("medic", harrach!.id), rouiba!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(firstEvent(appUser("dispatcher"), rouiba!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(eventOf(await firstEvent(appUser("admin"), rouiba!.id))).toMatchObject({ type: "ready" });
  });

  it("replays an assignment a reconnecting tablet missed", async () => {
    const { as, dispatch, addUnits, report } = await setup();
    const [harrach] = await addUnits(EL_HARRACH_MED);
    const incidentId = await report();
    const medic = as(appUser("medic", harrach!.id));
    const ready = (await (await medic.onUnit({ unitId: harrach!.id }))[Symbol.asyncIterator]().next()).value;
    const lastEventId = (ready as unknown as [string, unknown])[0];

    const { version } = await dispatch.recommendation({ incidentId }); // the tablet is offline from here
    await dispatch.approve({ incidentId, expectedVersion: version, unitIds: [harrach!.id] });

    const replay = (await medic.onUnit({ unitId: harrach!.id, lastEventId }))[Symbol.asyncIterator]();
    expect(eventOf((await replay.next()).value)).toMatchObject({ type: "dispatch.assigned", incidentId });
    await replay.return?.(undefined);
  });
});

/** An incident dispatched to El Harrach's medicalised ambulance, with a note for the crew. */
async function dispatched() {
  const world = await setup();
  const [harrach, rouiba] = await world.addUnits(EL_HARRACH_MED, ROUIBA_VSAV);
  const incidentId = await world.report();
  const { version } = await world.dispatch.recommendation({ incidentId });
  await world.dispatch.approve({ incidentId, expectedVersion: version, unitIds: [harrach!.id], notes: "Accès par la voie rapide" });
  const medic = (unit: typeof harrach) => world.as(appUser("medic", unit!.id));
  return { ...world, incidentId, harrach: harrach!, rouiba: rouiba!, medic };
}

describe("dispatch.currentMission (what the ambulance tablet shows)", () => {
  it("is empty until the unit is dispatched, then shows where to go and what the dispatcher said", async () => {
    const { as, addUnits, report, dispatch } = await setup();
    const [harrach] = await addUnits(EL_HARRACH_MED);
    const incidentId = await report();
    const medic = as(appUser("medic", harrach!.id));
    expect(await medic.currentMission({ unitId: harrach!.id })).toBeNull();

    const { version } = await dispatch.recommendation({ incidentId });
    await dispatch.approve({ incidentId, expectedVersion: version, unitIds: [harrach!.id], notes: "Accès par la voie rapide" });

    const mission = await medic.currentMission({ unitId: harrach!.id });
    expect(mission).toMatchObject({
      incidentId,
      status: "dispatched",
      notes: "Accès par la voie rapide",
      severity: "red",
      victims: 2,
      units: [{ callSign: "EH-MED", type: "ambulance_medicalisee" }],
    });
    expect(mission!.location.geohash8).toBe("snd2bmtf"); // where the alert said it was
    expect(mission!.location.lat).toBeCloseTo(36.7255, 1);
  });

  it("warns the crew about the victim's medical profile without revealing who they are", async () => {
    const { db, as, addUnits, report, dispatch } = await setup();
    const [harrach] = await addUnits(EL_HARRACH_MED);
    const incidentId = await report();
    const [profile] = await db
      .insert(medicalProfiles)
      .values({
        shortCode: "AB12CD34",
        fullName: "Nom Secret",
        birthDate: "1980-05-01",
        sex: "male",
        bloodType: "O-",
        allergies: ["pénicilline"],
        medications: [
          { name: "Warfarine", class: "anticoagulant" },
          { name: "Bisoprolol", class: "beta_blocker" },
        ],
        consentAt: new Date(),
      })
      .returning();
    await db.update(masterIncidents).set({ linkedProfileIds: [profile!.id] }).where(eq(masterIncidents.id, incidentId));
    const { version } = await dispatch.recommendation({ incidentId });
    await dispatch.approve({ incidentId, expectedVersion: version, unitIds: [harrach!.id] });

    const mission = await as(appUser("medic", harrach!.id)).currentMission({ unitId: harrach!.id });

    expect(mission!.profileBanner).toMatchObject({ high: true });
    expect(mission!.profileBanner!.flags).toEqual(
      expect.arrayContaining(["risque hémorragique interne", "SI peu fiable", "Allergie : pénicilline"]),
    );
    expect(JSON.stringify(mission)).not.toContain("Nom Secret");
  });

  it("is private to the dispatched unit's medic (and the admin)", async () => {
    const { medic, as, harrach, rouiba } = await dispatched();
    await expect(medic(rouiba).currentMission({ unitId: harrach.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await as(appUser("admin")).currentMission({ unitId: harrach.id })).not.toBeNull();
    expect(await medic(rouiba).currentMission({ unitId: rouiba.id })).toBeNull(); // not dispatched
  });
});

describe("dispatch.arrive (« Arrivé sur les lieux »)", () => {
  it("moves the incident to on_scene and logs who arrived", async () => {
    const { medic, harrach, incidentId, dispatch, journal } = await dispatched();

    await medic(harrach).arrive({ incidentId, unitId: harrach.id });

    expect((await dispatch.recommendation({ incidentId })).status).toBe("on_scene");
    expect((await medic(harrach).currentMission({ unitId: harrach.id }))!.status).toBe("on_scene");
    const event = (await journal(incidentId)).find((e) => e.type === "unit.arrived");
    expect(event).toMatchObject({ actorRole: "medic" });
    expect(event?.payload).toMatchObject({ unitId: harrach.id });
  });

  it("tells the dispatchers' queue the incident is now on scene", async () => {
    const { medic, harrach, incidentId, events } = await dispatched();
    const stream = events.stream();
    const it = stream[Symbol.asyncIterator]();
    await it.next(); // ready

    await medic(harrach).arrive({ incidentId, unitId: harrach.id });

    const { event } = (await it.next()).value!;
    expect(event).toMatchObject({ type: "incident.updated", incident: { id: incidentId, status: "on_scene" } });
    await it.return?.(undefined);
  });

  it("is harmless when pressed twice", async () => {
    const { medic, harrach, incidentId, journal } = await dispatched();
    await medic(harrach).arrive({ incidentId, unitId: harrach.id });
    await medic(harrach).arrive({ incidentId, unitId: harrach.id });
    expect((await journal(incidentId)).filter((e) => e.type === "unit.arrived")).toHaveLength(1);
  });

  it("refuses a unit that was not dispatched to this incident, and an incident nobody was dispatched to", async () => {
    const { medic, rouiba, incidentId, report, harrach } = await dispatched();
    await expect(medic(rouiba).arrive({ incidentId, unitId: rouiba.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(medic(harrach).arrive({ incidentId, unitId: rouiba.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const undispatched = await report({ ...fireAtBabEzzouar, geohash: "snd1jdg6" }, "+213550000002");
    await expect(medic(harrach).arrive({ incidentId: undispatched, unitId: harrach.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
