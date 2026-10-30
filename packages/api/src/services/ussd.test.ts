import { cellTowers } from "@solvex-dergana/db/schema/index";
import { createTestDb } from "@solvex-dergana/db/testing";
import { describe, expect, it } from "vitest";

import { createEventBus } from "./events";
import { getIncident, listIncidents } from "./incidents";
import { handleUssd, sweepUssdSessions } from "./ussd";

const PHONE = "+213550000042";
const T0 = new Date("2026-10-30T10:00:00Z");
const after = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

// Made-up tower ids (test data) at real places.
const EL_HARRACH = { mcc: 603, mnc: 1, lac: 100, cid: 2, lat: 36.7197, lng: 3.1347, rangeM: 900, source: "opencellid" as const };
const ALGER_CENTRE = { mcc: 603, mnc: 1, lac: 100, cid: 3, lat: 36.7733, lng: 3.0588, rangeM: 3_000, source: "opencellid" as const };

/** An operator talking to the SVX USSD service, the way an aggregator does: every request carries all answers so far. */
async function setup({ emulated = true }: { emulated?: boolean } = {}) {
  const db = await createTestDb();
  await db.insert(cellTowers).values([EL_HARRACH, ALGER_CENTRE]);
  const deps = { db, events: createEventBus() };
  return {
    db,
    deps,
    /** One request. `cellId` is the cell the call is on (decimal `mcc-mnc-lac-cid`), when the operator tells us. */
    dial: (text: string, { session = "S1", cellId, at = T0 }: { session?: string; cellId?: string; at?: Date } = {}) =>
      handleUssd(deps, { sessionId: session, serviceCode: "*140#", phoneNumber: PHONE, text, cellId }, { emulated, now: at }),
    incidents: () => listIncidents(db),
  };
}

describe("USSD: walking the menu", () => {
  it("asks victims, conscious, danger, place and a confirmation, then files one alert and gives its reference", async () => {
    const { dial, incidents } = await setup();

    expect(await dial("")).toMatchObject({ type: "CON", message: expect.stringMatching(/victimes/i) });
    expect(await dial("2")).toMatchObject({ type: "CON", message: expect.stringMatching(/conscient/i) });
    expect(await dial("2*1")).toMatchObject({ type: "CON", message: expect.stringMatching(/danger/i) });
    expect(await dial("2*1*1")).toMatchObject({ type: "CON", message: expect.stringMatching(/commune/i) });
    expect(await dial("2*1*1*0")).toMatchObject({ type: "CON", message: expect.stringMatching(/envoyer/i) }); // 0 = skip the place
    expect(await incidents()).toHaveLength(0); // nothing is filed before the caller confirms

    const last = await dial("2*1*1*0*1");

    expect(last.type).toBe("END");
    expect(last.message).toMatch(/[0-9A-F]{8}/);
    expect(await incidents()).toHaveLength(1);
  });

  it("files the answers as the USSD alert they are: layer 3, channel ussd, and flagged emulated when the operator is the emulator", async () => {
    const { dial, incidents, db } = await setup({ emulated: true });
    for (const text of ["", "3", "3*2", "3*2*1", "3*2*1*0", "3*2*1*0*1"]) await dial(text);

    const [incident] = await incidents();
    const { alerts } = (await getIncident(db, incident!.id))!;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      source: "ussd",
      channel: "ussd",
      emulated: true,
      victims: 3, // "3 ou plus"
      conscious: 0, // "Non": nobody is conscious (protocol: 0 none, 1 all, 2 don't know)
      fire: true, // danger 1 = Feu
    });
  });

  it("is not flagged emulated when a real operator calls", async () => {
    const { dial, incidents, db } = await setup({ emulated: false });
    for (const text of ["", "1", "1*1", "1*1*4", "1*1*4*0", "1*1*4*0*1"]) await dial(text);

    const [incident] = await incidents();
    expect((await getIncident(db, incident!.id))!.alerts[0]).toMatchObject({ emulated: false, fire: false, trapped: false });
  });

  it("files nothing when the caller cancels at the confirmation", async () => {
    const { dial, incidents } = await setup();
    for (const text of ["", "2", "2*1", "2*1*1", "2*1*1*0"]) await dial(text);

    expect(await dial("2*1*1*0*2")).toMatchObject({ type: "END" });
    expect(await incidents()).toHaveLength(0);
  });

  it("answers the same way to a repeated last request, without filing a second alert", async () => {
    const { dial, incidents } = await setup();
    for (const text of ["", "2", "2*1", "2*1*1", "2*1*1*0"]) await dial(text);

    const first = await dial("2*1*1*0*1");
    const again = await dial("2*1*1*0*1");

    expect(again).toEqual(first);
    expect(await incidents()).toHaveLength(1);
  });

  it("keeps two callers' sessions apart", async () => {
    const { dial, incidents } = await setup();
    await dial("", { session: "A" });
    await dial("", { session: "B" });
    for (const text of ["2", "2*1", "2*1*1", "2*1*1*0", "2*1*1*0*1"]) await dial(text, { session: "A" });

    expect(await incidents()).toHaveLength(1); // B has not finished
  });
});

describe("USSD: where it happened", () => {
  const walk = async (cellId: string | undefined, place = "0") => {
    const world = await setup();
    for (const text of ["", "2", "2*1", "2*1*1", `2*1*1*${place}`, `2*1*1*${place}*1`]) await world.dial(text, { cellId });
    return (await world.incidents())[0]!;
  };

  it("is the tower the call came through, with the tower's range as the uncertainty", async () => {
    const incident = await walk("603-1-100-2");
    expect(incident).toMatchObject({ lat: 36.7197, lng: 3.1347, locationUncertaintyM: 900 });
  });

  it("uses the place the caller typed when it is more precise than a distant tower", async () => {
    // Alger-Centre's tower reaches 3 km; "Rouiba" is a commune (about 1.5 km): the caller's word is the better fix.
    const incident = await walk("603-1-100-3", "Rouiba");
    expect(incident.lat).toBeCloseTo(36.7381, 2);
    expect(incident).toMatchObject({ commune: "Rouiba", locationUncertaintyM: 1_500 });
  });

  it("keeps the tower when it is more precise than what the caller typed", async () => {
    const incident = await walk("603-1-100-2", "Rouiba"); // El Harrach's tower reaches only 900 m
    expect(incident).toMatchObject({ lat: 36.7197, locationUncertaintyM: 900 });
  });

  it("is still filed, without a position, when there is no cell and no place (a distress signal is never dropped)", async () => {
    const incident = await walk(undefined);
    expect(incident).toMatchObject({ lat: null, lng: null });
    expect(incident.estimatedVictims).toBe(2);
  });
});

describe("USSD: wrong answers", () => {
  it("ends the session on a choice that is not on the menu, but keeps what was already answered as an alert", async () => {
    const { dial, incidents } = await setup();
    await dial("");
    await dial("2");

    const refused = await dial("2*9"); // 9 is not one of the three conscious choices

    expect(refused).toMatchObject({ type: "END", message: expect.stringMatching(/invalide/i) });
    const [incident] = await incidents();
    expect(incident).toMatchObject({ estimatedVictims: 2 }); // the victims answer is not lost
  });

  it("files nothing when nothing valid was answered", async () => {
    const { dial, incidents } = await setup();
    await dial("");

    expect(await dial("7")).toMatchObject({ type: "END" });
    expect(await incidents()).toHaveLength(0);
  });
});

describe("USSD: a session that goes quiet (120 s)", () => {
  it("saves what was answered after 120 seconds of silence, located by the cell", async () => {
    const { dial, incidents, deps } = await setup();
    await dial("", { cellId: "603-1-100-2" });
    await dial("2", { cellId: "603-1-100-2" });
    await dial("2*1", { cellId: "603-1-100-2", at: after(10) }); // the caller then stops answering

    expect(await sweepUssdSessions(deps, after(129))).toBe(0); // not yet: 119 s of silence
    expect(await incidents()).toHaveLength(0);

    expect(await sweepUssdSessions(deps, after(130))).toBe(1); // 120 s of silence
    const [incident] = await incidents();
    expect(incident).toMatchObject({ estimatedVictims: 2, lat: 36.7197, locationUncertaintyM: 900 });
    expect(await sweepUssdSessions(deps, after(300))).toBe(0); // saved once only
  });

  it("files nothing for a session that never answered, and does not look at it again", async () => {
    const { dial, incidents, deps } = await setup();
    await dial("");

    expect(await sweepUssdSessions(deps, after(200))).toBe(0);
    expect(await incidents()).toHaveLength(0);
  });

  it("does not file a second alert when the caller comes back after the partial save", async () => {
    const { dial, incidents, deps } = await setup();
    await dial("");
    await dial("2");
    await sweepUssdSessions(deps, after(200));

    expect(await dial("2*1", { at: after(210) })).toMatchObject({ type: "END" }); // the operator closed it long ago
    expect(await incidents()).toHaveLength(1);
  });
});
