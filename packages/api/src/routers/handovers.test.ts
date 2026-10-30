import { createTestDb } from "@solvex-dergana/db/testing";
import {
  ambulanceUnits,
  handovers,
  hospitalsMatrix,
  incidentEvents,
  masterIncidents,
  medicalProfiles,
} from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { t } from "../index";
import { createEventBus } from "../services/events";
import { appRouter } from "./index";

const CAPS = {
  capNeurosurgery: true, capCtScanner: true, capBurnUnit: true, capIcu: true,
  capTraumaSurgery: true, capPediatric: true, capObstetrics: true, capBloodBank: true,
};

async function setup() {
  const db = await createTestDb();
  const events = createEventBus();
  const [unit, otherUnit] = await db
    .insert(ambulanceUnits)
    .values([
      { callSign: "AMB-1", type: "ambulance_medicalisee", baseName: "Alger-Centre", lat: 36.77, lng: 3.06 },
      { callSign: "AMB-2", type: "ambulance_medicalisee", baseName: "Rouiba", lat: 36.74, lng: 3.28 },
    ])
    .returning();
  const place = { commune: "Alger", wilaya: "Alger", tier: "chu" as const };
  const [hospitalA, hospitalB] = await db
    .insert(hospitalsMatrix)
    .values([
      { ...place, name: "CHU Proche", shortName: "Proche", lat: 36.7614, lng: 3.0586, ...CAPS },
      { ...place, name: "EPH Lointain", shortName: "Lointain", lat: 36.738, lng: 3.28, ...CAPS },
    ])
    .returning();
  const [profile] = await db
    .insert(medicalProfiles)
    .values({
      shortCode: "AB12CD34", fullName: "Karim Test", birthDate: "1950-01-01", sex: "male", bloodType: "A+",
      allergies: ["pénicilline"], medications: [{ name: "Sintrom", class: "anticoagulant" }],
      emergencyContact: "0555 12 34 56", consentAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  const [incident] = await db
    .insert(masterIncidents)
    .values({
      firstAlertAt: new Date("2026-10-30T09:02:00Z"), lastAlertAt: new Date("2026-10-30T09:02:00Z"),
      lat: 36.7538, lng: 3.0588, recSeverity: "red", linkedProfileIds: [profile!.id],
      vittelPrefill: { l2: { rollover: { value: true, source: "iot" } } },
    })
    .returning();

  const as = (appUser: AppUserContext) =>
    t.createCallerFactory(appRouter)({ db, events, session: { user: { id: "auth" } }, appUser } as unknown as Context);
  const medic = as({ id: "medic-1", role: "medic", unitId: unit!.id, hospitalId: null });
  const otherMedic = as({ id: "medic-2", role: "medic", unitId: otherUnit!.id, hospitalId: null });
  const hospitalCallerA = as({ id: "hosp-a", role: "hospital", unitId: null, hospitalId: hospitalA!.id });
  const hospitalCallerB = as({ id: "hosp-b", role: "hospital", unitId: null, hospitalId: hospitalB!.id });
  const admin = as({ id: "admin-1", role: "admin", unitId: null, hospitalId: null });
  const dispatcher = as({ id: "disp-1", role: "dispatcher", unitId: null, hospitalId: null });

  /** A saved bilan whose destination is the given hospital. */
  const saveBilan = (hospitalId: string | undefined, over: Record<string, unknown> = {}) =>
    medic.assessments.save({
      incidentId: incident!.id, profileId: profile!.id, hr: 130, sbp: 85, gcs: 12, spo2: 92, dbp: 50, rr: 24,
      suspectedInjuries: ["Thorax"], treatments: ["Oxygène"], chosenHospitalId: hospitalId,
      overrideReason: "test", ...over,
    });

  return { db, events, medic, otherMedic, hospitalCallerA, hospitalCallerB, admin, dispatcher, unit: unit!, otherUnit: otherUnit!, hospitalA: hospitalA!, hospitalB: hospitalB!, incident: incident!, profile: profile!, saveBilan };
}

type Heard = { id: string; event: { type: string } & Record<string, unknown> };

/** Collects what a subscription delivers, in the background, while the test acts. */
function listen(stream: AsyncIterable<unknown>) {
  const heard: Heard[] = [];
  const iterator = stream[Symbol.asyncIterator]();
  void (async () => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      const [id, event] = next.value as [string, Heard["event"]];
      heard.push({ id, event });
    }
  })();
  return {
    heard,
    types: () => heard.map((h) => h.event.type),
    // Not awaited: a generator waiting for its next event only finishes when one comes.
    stop: () => void iterator.return?.(undefined),
  };
}
/** Long enough for an event published a moment ago to have been delivered. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

describe("handovers.send: the medic sends the AT-MIST to the chosen hospital", () => {
  it("creates a pending handover for the chosen hospital, with the AT-MIST written from the saved bilan", async () => {
    const { medic, saveBilan, hospitalA, db } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId });
    expect(sent).toMatchObject({ status: "pending", hospitalId: hospitalA.id });
    const [row] = await db.select().from(handovers).where(eq(handovers.id, sent.handoverId));
    expect(row).toMatchObject({ assessmentId, hospitalId: hospitalA.id, status: "pending", respondedAt: null });
    expect(row!.atmist).toMatchObject({
      version: 1, unit: "AMB-1", victimIndex: 1, age: 76, sex: "male", time: "10:02",
      mechanism: ["Tonneaux"], injuries: ["Thorax"], treatments: ["Oxygène"], severe: true,
      bloodType: "A+", allergies: ["pénicilline"],
      signs: { hr: 130, sbp: 85, gcs: 12, shockIndex: { flag: "critical" } },
    });
    expect((row!.atmist as { prep: string[] }).prep).toContain("bilan de coagulation / antidote");
  });

  it("returns the SMS rendering too, ready for the fallback of issue 13", async () => {
    const { medic, saveBilan, hospitalA } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId });
    expect(sent.sms.startsWith("AT-MIST AMB-1 V1 ;")).toBe(true);
    expect(sent.sms.length).toBeLessThanOrEqual(459);
  });

  it("keeps no name, contact, profile code or birth date in what it stores", async () => {
    const { medic, saveBilan, hospitalA, db } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    await medic.handovers.send({ assessmentId });
    const [row] = await db.select().from(handovers);
    const stored = JSON.stringify(row!.atmist);
    for (const secret of ["Karim", "0555", "AB12CD34", "1950"]) expect(stored).not.toContain(secret);
  });

  it("freezes the snapshot: saving the bilan again changes nothing in the handover", async () => {
    const { medic, saveBilan, hospitalA, db } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId });
    await saveBilan(hospitalA.id, { hr: 60, sbp: 120, treatments: ["Oxygène", "Garrot"] });
    const [row] = await db.select().from(handovers).where(eq(handovers.id, sent.handoverId));
    expect((row!.atmist as { signs: { hr: number }; treatments: string[] }).signs.hr).toBe(130);
    expect((row!.atmist as { treatments: string[] }).treatments).toEqual(["Oxygène"]);
  });

  it("does not send twice to the same hospital while the first is waiting", async () => {
    const { medic, saveBilan, hospitalA, db } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const first = await medic.handovers.send({ assessmentId });
    const again = await medic.handovers.send({ assessmentId });
    expect(again.handoverId).toBe(first.handoverId);
    expect(await db.select().from(handovers)).toHaveLength(1);
  });

  it("needs a destination: a bilan with no chosen hospital cannot be sent", async () => {
    const { medic, saveBilan } = await setup();
    const { assessmentId } = await saveBilan(undefined);
    await expect(medic.handovers.send({ assessmentId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("says so when the bilan does not exist", async () => {
    const { medic } = await setup();
    await expect(medic.handovers.send({ assessmentId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is closed to another ambulance's medic, to a dispatcher and to a hospital", async () => {
    const { medic, otherMedic, dispatcher, hospitalCallerA, saveBilan, hospitalA } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    await expect(otherMedic.handovers.send({ assessmentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(dispatcher.handovers.send({ assessmentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hospitalCallerA.handovers.send({ assessmentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(medic.handovers.send({ assessmentId })).resolves.toBeDefined();
  });

  it("writes who sent it, to whom, in the incident history", async () => {
    const { medic, saveBilan, hospitalA, db, incident } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId });
    const events = await db.select().from(incidentEvents).where(eq(incidentEvents.type, "handover.sent"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ incidentId: incident.id, actorRole: "medic", actorId: "medic-1" });
    expect(events[0]!.payload).toMatchObject({ handoverId: sent.handoverId, hospitalId: hospitalA.id, assessmentId });
  });
});

describe("handovers.respond: the hospital accepts or diverts", () => {
  async function sent() {
    const world = await setup();
    const { assessmentId } = await world.saveBilan(world.hospitalA.id);
    const handover = await world.medic.handovers.send({ assessmentId });
    return { ...world, assessmentId, handoverId: handover.handoverId };
  }

  it("accepts: the status, the time and who answered are recorded", async () => {
    const { hospitalCallerA, handoverId, db } = await sent();
    const answer = await hospitalCallerA.handovers.respond({ handoverId, decision: "accept" });
    expect(answer).toMatchObject({ status: "accepted", divertSpecialty: null });
    const [row] = await db.select().from(handovers).where(eq(handovers.id, handoverId));
    expect(row).toMatchObject({ status: "accepted", respondedBy: "hosp-a", divertSpecialty: null });
    expect(row!.respondedAt).toBeInstanceOf(Date);
  });

  it("diverts with the specialty that cannot be offered", async () => {
    const { hospitalCallerA, handoverId, db } = await sent();
    const answer = await hospitalCallerA.handovers.respond({ handoverId, decision: "divert", specialty: "neurosurgery" });
    expect(answer).toMatchObject({ status: "diverted", divertSpecialty: "neurosurgery" });
    const [row] = await db.select().from(handovers).where(eq(handovers.id, handoverId));
    expect(row).toMatchObject({ status: "diverted", divertSpecialty: "neurosurgery" });
  });

  it("refuses a divert without a specialty, or with one that does not exist", async () => {
    const { hospitalCallerA, handoverId } = await sent();
    await expect(hospitalCallerA.handovers.respond({ handoverId, decision: "divert" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      hospitalCallerA.handovers.respond({ handoverId, decision: "divert", specialty: "astrology" as never }),
    ).rejects.toThrow();
  });

  it("answers once: a second answer, even the same, is a conflict", async () => {
    const { hospitalCallerA, handoverId } = await sent();
    await hospitalCallerA.handovers.respond({ handoverId, decision: "accept" });
    await expect(hospitalCallerA.handovers.respond({ handoverId, decision: "divert", specialty: "icu" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(hospitalCallerA.handovers.respond({ handoverId, decision: "accept" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("is for the addressed hospital only, and the admin (demo operator)", async () => {
    const { hospitalCallerB, admin, medic, dispatcher, handoverId } = await sent();
    await expect(hospitalCallerB.handovers.respond({ handoverId, decision: "accept" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(medic.handovers.respond({ handoverId, decision: "accept" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(dispatcher.handovers.respond({ handoverId, decision: "accept" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.handovers.respond({ handoverId, decision: "accept" })).resolves.toMatchObject({ status: "accepted" });
  });

  it("says so when the handover does not exist", async () => {
    const { hospitalCallerA } = await sent();
    await expect(
      hospitalCallerA.handovers.respond({ handoverId: "00000000-0000-4000-8000-000000000000", decision: "accept" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes the answer in the incident history, with the specialty on a divert", async () => {
    const { hospitalCallerA, handoverId, db } = await sent();
    await hospitalCallerA.handovers.respond({ handoverId, decision: "divert", specialty: "ct_scanner" });
    const [event] = await db.select().from(incidentEvents).where(eq(incidentEvents.type, "handover.diverted"));
    expect(event).toMatchObject({ actorRole: "hospital", actorId: "hosp-a" });
    expect(event!.payload).toMatchObject({ handoverId, specialty: "ct_scanner" });
  });

  it("lets the medic send a new handover to the next hospital after a divert; the old one stays as it was", async () => {
    const { hospitalCallerA, medic, handoverId, assessmentId, saveBilan, hospitalB, db } = await sent();
    await hospitalCallerA.handovers.respond({ handoverId, decision: "divert", specialty: "neurosurgery" });
    await saveBilan(hospitalB.id);
    const next = await medic.handovers.send({ assessmentId });
    expect(next.handoverId).not.toBe(handoverId);
    expect(next.hospitalId).toBe(hospitalB.id);
    const rows = await db.select().from(handovers);
    expect(rows.map((r) => r.status).sort()).toEqual(["diverted", "pending"]);
  });
});

describe("after a divert, the server recommendation skips that hospital", () => {
  it("recommends the next best, so confirming it needs no reason", async () => {
    const { hospitalCallerA, medic, saveBilan, hospitalA, hospitalB } = await setup();
    const first = await saveBilan(hospitalA.id, { overrideReason: undefined });
    expect(first.recommendation!.recommended!.hospitalId).toBe(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId: first.assessmentId });
    await hospitalCallerA.handovers.respond({ handoverId: sent.handoverId, decision: "divert", specialty: "neurosurgery" });

    const again = await saveBilan(hospitalB.id, { overrideReason: undefined });
    expect(again.recommendation!.recommended!.hospitalId).toBe(hospitalB.id);
    expect(again.recommendation!.ranking.at(-1)).toMatchObject({ hospitalId: hospitalA.id, flags: ["declined"] });
  });

  it("does not skip a hospital that only accepted, or one that was never asked", async () => {
    const { hospitalCallerA, medic, saveBilan, hospitalA } = await setup();
    const first = await saveBilan(hospitalA.id, { overrideReason: undefined });
    const sent = await medic.handovers.send({ assessmentId: first.assessmentId });
    await hospitalCallerA.handovers.respond({ handoverId: sent.handoverId, decision: "accept" });
    const again = await saveBilan(hospitalA.id, { overrideReason: undefined });
    expect(again.recommendation!.recommended!.hospitalId).toBe(hospitalA.id);
  });
});

describe("handovers.incoming and handovers.forAssessment: what each screen reads", () => {
  it("lists a hospital's own handovers, newest first, and none of the others", async () => {
    const { medic, hospitalCallerA, hospitalCallerB, saveBilan, hospitalA, hospitalB } = await setup();
    const first = await saveBilan(hospitalA.id);
    const a = await medic.handovers.send({ assessmentId: first.assessmentId });
    const second = await saveBilan(hospitalB.id, { victimIndex: 2 });
    await medic.handovers.send({ assessmentId: second.assessmentId });
    const forA = await hospitalCallerA.handovers.incoming();
    expect(forA.map((h) => h.id)).toEqual([a.handoverId]);
    expect(forA[0]!.atmist).toMatchObject({ unit: "AMB-1" });
    expect(await hospitalCallerB.handovers.incoming()).toHaveLength(1);
  });

  it("gives the medic the handovers of a bilan, to show their status", async () => {
    const { medic, otherMedic, hospitalCallerA, saveBilan, hospitalA } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sentOne = await medic.handovers.send({ assessmentId });
    await hospitalCallerA.handovers.respond({ handoverId: sentOne.handoverId, decision: "divert", specialty: "icu" });
    const list = await medic.handovers.forAssessment({ assessmentId });
    expect(list).toMatchObject([{ id: sentOne.handoverId, status: "diverted", divertSpecialty: "icu", hospitalId: hospitalA.id }]);
    await expect(otherMedic.handovers.forAssessment({ assessmentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("handover realtime: hospital:{id} and unit:{id} (PRD FR-S3-21)", () => {
  it("tells the addressed hospital at once, and nobody else", async () => {
    const { medic, hospitalCallerA, hospitalCallerB, saveBilan, hospitalA } = await setup();
    const a = listen(await hospitalCallerA.handovers.onHospital({}));
    const b = listen(await hospitalCallerB.handovers.onHospital({}));
    await settle();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId });
    await settle();
    expect(a.types()).toEqual(["ready", "handover.incoming"]);
    expect(a.heard[1]!.event).toMatchObject({ handover: { id: sent.handoverId, hospitalId: hospitalA.id, status: "pending" } });
    expect((a.heard[1]!.event as unknown as { handover: { atmist: { unit: string } } }).handover.atmist.unit).toBe("AMB-1");
    expect(b.types()).toEqual(["ready"]);
    a.stop();
    b.stop();
  });

  it("tells the ambulance what the hospital answered, and no other ambulance", async () => {
    const { medic, otherMedic, hospitalCallerA, saveBilan, hospitalA } = await setup();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId });
    const mine = listen(await medic.handovers.onUnit({}));
    const theirs = listen(await otherMedic.handovers.onUnit({}));
    await settle();
    await hospitalCallerA.handovers.respond({ handoverId: sent.handoverId, decision: "divert", specialty: "neurosurgery" });
    await settle();
    expect(mine.types()).toEqual(["ready", "handover.updated"]);
    expect(mine.heard[1]!.event).toMatchObject({
      handoverId: sent.handoverId, hospitalId: hospitalA.id, status: "diverted", divertSpecialty: "neurosurgery",
    });
    expect(theirs.types()).toEqual(["ready"]);
    mine.stop();
    theirs.stop();
  });

  it("picks up where it left off after a dropped connection", async () => {
    const { medic, hospitalCallerA, saveBilan, hospitalA } = await setup();
    const first = listen(await hospitalCallerA.handovers.onHospital({}));
    await settle();
    const readyId = first.heard[0]!.id;
    first.stop();
    const { assessmentId } = await saveBilan(hospitalA.id);
    const sent = await medic.handovers.send({ assessmentId });
    const again = listen(await hospitalCallerA.handovers.onHospital({ lastEventId: readyId }));
    await settle();
    expect(again.types()).toEqual(["handover.incoming"]);
    expect(again.heard[0]!.event).toMatchObject({ handover: { id: sent.handoverId } });
    again.stop();
  });

  it("only lets a hospital hear its own channel and an ambulance its own", async () => {
    const { hospitalCallerA, medic, hospitalB, otherUnit, admin, hospitalA } = await setup();
    await expect(hospitalCallerA.handovers.onHospital({ hospitalId: hospitalB.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(medic.handovers.onUnit({ unitId: otherUnit.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The admin (demo operator) belongs to neither, so names the channel.
    const named = listen(await admin.handovers.onHospital({ hospitalId: hospitalA.id }));
    await settle();
    expect(named.types()).toEqual(["ready"]);
    named.stop();
    await expect(admin.handovers.onHospital({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
