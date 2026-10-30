import { masterIncidents } from "@solvex-dergana/db/schema/index";
import { createTestDb } from "@solvex-dergana/db/testing";
import { encodeSvx, type SvxAlert } from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createEventBus } from "./events";
import { getIncident, listIncidents } from "./incidents";
import { ingestSms } from "./ingest";

// Geohash cells north of Bab Ezzouar, at distances worked out independently (Python):
// each step of one cell is 19.1 m.
const CELL = {
  here: "snd2bmtf", // 0 m
  m190: "snd2bmvu", // 190.9 m: inside the 200 m base distance
  m210: "snd2bmvv", // 210.0 m: needs the uncertainty allowance, so tentative
  m400: "snd2bqjz", // 400.8 m: too far from "here"
  m1145: "snd2brmy", // 1145 m
} as const;

// 2026-10-30T09:00:00Z
const T0 = 29889180;
const minutes = (n: number) => new Date((T0 + n) * 60_000);

type Report = {
  at: number; // event time, in minutes after T0
  geohash?: string | null;
  layer?: 1 | 2 | 3;
  peakG?: number | null;
  victims?: number;
  from?: string;
  receivedAfter?: number; // minutes after the event (default 1)
  corrupt?: boolean;
  eventMinutes?: number; // overrides the event time written in the SMS
};

function report(r: Report) {
  const alert: SvxAlert = {
    layer: r.layer ?? 2,
    geohash: r.geohash === undefined ? CELL.here : r.geohash,
    eventMinutes: r.eventMinutes ?? T0 + r.at,
    peakG: r.peakG ?? null,
    rollover: null,
    fire: false,
    victims: r.victims ?? 2,
    conscious: 1,
    trapped: false,
    bleeding: false,
    profileCode: null,
    deltaVKmh: null,
    cell: null,
  };
  let body = encodeSvx(alert);
  if (r.corrupt) body = body.replace(`#V:${alert.victims}#`, `#V:${(alert.victims ?? 0) + 3}#`);
  return {
    from: r.from ?? "+213550000001",
    body,
    receivedAt: minutes(r.at + (r.receivedAfter ?? 1)),
    emulated: true,
  };
}

async function setup() {
  const db = await createTestDb();
  const events = createEventBus();
  const send = (r: Report) => ingestSms({ db, events }, report(r));
  return { db, events, send };
}

describe("clustering: alerts about the same crash merge into one incident", () => {
  it("merges a second alert from the same spot a few minutes later; the count grows", async () => {
    const { db, send } = await setup();
    const first = await send({ at: 0, from: "+213550000001" });
    const second = await send({ at: 5, from: "+213550000002" });
    if (first.kind !== "alert" || second.kind !== "alert") throw new Error("expected alerts");

    expect(second.incidentId).toBe(first.incidentId);
    expect(second.ack).toBe(first.ack);
    expect(second.duplicate).toBe(false);

    const incidents = await listIncidents(db);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ alertCount: 2 });
    expect((await getIncident(db, first.incidentId))?.alerts).toHaveLength(2);
  });

  it("keeps alerts apart when they are too far away or too long apart", async () => {
    const { db, send } = await setup();
    await send({ at: 0, from: "+213550000001" });
    await send({ at: 3, geohash: CELL.m1145, from: "+213550000002" }); // 1145 m away
    await send({ at: 11, from: "+213550000003" }); // 11 minutes after the last alert of the first incident
    expect(await listIncidents(db)).toHaveLength(3);
  });

  it("measures the 10 minutes from the latest alert of the incident (a sliding window)", async () => {
    const { db, send } = await setup();
    await send({ at: 0, from: "+213550000001" });
    await send({ at: 8, from: "+213550000002" });
    await send({ at: 16, from: "+213550000003" }); // 16 min after the first, but only 8 after the latest
    expect(await listIncidents(db)).toHaveLength(1);
    expect((await listIncidents(db))[0]).toMatchObject({ alertCount: 3 });
  });

  it("raises the confidence as alerts add up, and more when different layers agree", async () => {
    const twoWitnesses = await setup();
    await twoWitnesses.send({ at: 0, from: "+213550000001" });
    await twoWitnesses.send({ at: 1, from: "+213550000002" });
    // 1 - 0.6 * 0.6, no bonus: both are phone reports
    expect(Number((await listIncidents(twoWitnesses.db))[0]?.confidenceScore)).toBeCloseTo(0.64, 3);

    const chipAndWitness = await setup();
    await chipAndWitness.send({ at: 0, from: "+213550000001" });
    await chipAndWitness.send({ at: 1, layer: 1, peakG: 8.5, from: "+213550000002" });
    // The chip SMS comes from a number that is not a registered vehicle: unauthenticated, so it counts half
    // (PRD FR-S3-13). Witness 0.4, chip 0.6 x 0.5: 1 - 0.6 * 0.7 = 0.58, plus the 0.1 bonus for two different layers.
    expect(Number((await listIncidents(chipAndWitness.db))[0]?.confidenceScore)).toBeCloseTo(0.68, 3);
  });

  it("keeps the time span of the incident and the highest victim count", async () => {
    const { db, send } = await setup();
    await send({ at: 0, victims: 2, from: "+213550000001" });
    await send({ at: 4, victims: 5, from: "+213550000002" });
    await send({ at: 2, victims: 3, from: "+213550000003" }); // an older report arriving last
    const [incident] = await listIncidents(db);
    expect(incident).toMatchObject({ alertCount: 3, estimatedVictims: 5 });
    expect(incident?.firstAlertAt).toEqual(minutes(0));
    expect(incident?.lastAlertAt).toEqual(minutes(4));
  });

  it("marks a merge as tentative only when it relied on the uncertainty allowance", async () => {
    const near = await setup();
    const a = await near.send({ at: 0, from: "+213550000001" });
    await near.send({ at: 1, geohash: CELL.m190, from: "+213550000002" }); // 190.9 m: within 200 m
    if (a.kind !== "alert") throw new Error("expected an alert");
    const plain = await getIncident(near.db, a.incidentId);
    expect(plain?.alerts.map((x) => x.mergeTentative)).toEqual([false, false]);

    const edge = await setup();
    const b = await edge.send({ at: 0, from: "+213550000001" });
    await edge.send({ at: 1, geohash: CELL.m210, from: "+213550000002" }); // 210.0 m: needs the allowance
    if (b.kind !== "alert") throw new Error("expected an alert");
    const tentative = await getIncident(edge.db, b.incidentId);
    expect(tentative?.alerts.map((x) => x.mergeTentative)).toEqual([false, true]);
  });

  it("tells the queue when an incident contains a tentative merge, so the dispatcher can confirm it", async () => {
    const sure = await setup();
    await sure.send({ at: 0, from: "+213550000001" });
    await sure.send({ at: 1, geohash: CELL.m190, from: "+213550000002" });
    expect((await listIncidents(sure.db))[0]?.tentative).toBe(false);

    const unsure = await setup();
    await unsure.send({ at: 0, from: "+213550000001" });
    await unsure.send({ at: 1, geohash: CELL.m210, from: "+213550000002" });
    expect((await listIncidents(unsure.db))[0]?.tentative).toBe(true);
  });

  it("merges a late SMS by the time of the event, not the time it arrived", async () => {
    const { db, send } = await setup();
    await send({ at: 0, from: "+213550000001" });
    // The crash was 3 minutes after the first alert, but the SMS only got through an hour later.
    await send({ at: 3, receivedAfter: 60, from: "+213550000002" });
    const incidents = await listIncidents(db);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.lastAlertAt).toEqual(minutes(3));
  });

  it("ignores an event time that is more than 24 hours off and uses the time of receipt instead", async () => {
    const { db, send } = await setup();
    await send({ at: 0, from: "+213550000001" });
    // A device whose clock is 3 days behind: written time T0 - 3 days, received 4 minutes after the first alert.
    const skewed = await send({ at: 4, receivedAfter: 0, eventMinutes: T0 - 3 * 24 * 60, from: "+213550000002" });
    if (skewed.kind !== "alert") throw new Error("expected an alert");
    const incidents = await listIncidents(db);
    expect(incidents).toHaveLength(1); // matched on the time of receipt (09:04), not the bogus event time
    expect(incidents[0]?.lastAlertAt).toEqual(minutes(4));
  });

  it("joins the nearest incident when several match", async () => {
    const { db, send } = await setup();
    const a = await send({ at: 0, geohash: CELL.here, from: "+213550000001" });
    const b = await send({ at: 0, geohash: CELL.m400, from: "+213550000002" }); // 400.8 m from A: separate
    // C is 190.9 m from A (within 200 m) and 210.0 m from B (needs the allowance): both match, A is nearer.
    const c = await send({ at: 1, geohash: CELL.m190, from: "+213550000003" });
    if (a.kind !== "alert" || b.kind !== "alert" || c.kind !== "alert") throw new Error("expected alerts");

    expect(b.incidentId).not.toBe(a.incidentId);
    expect(c.incidentId).toBe(a.incidentId);
    expect(await listIncidents(db)).toHaveLength(2);
  });

  it("trusts a corrupted alert less", async () => {
    const { db, send } = await setup();
    await send({ at: 0, from: "+213550000001" });
    await send({ at: 1, corrupt: true, from: "+213550000002" });
    // Witness 0.4, plus a witness with a bad checksum at half weight 0.2: 1 - 0.6 * 0.8
    expect(Number((await listIncidents(db))[0]?.confidenceScore)).toBeCloseTo(0.52, 3);
  });

  it("does not merge into an incident that is closed", async () => {
    const { db, send } = await setup();
    const first = await send({ at: 0, from: "+213550000001" });
    if (first.kind !== "alert") throw new Error("expected an alert");
    await db.update(masterIncidents).set({ status: "closed" }).where(eq(masterIncidents.id, first.incidentId));

    const second = await send({ at: 2, from: "+213550000002" });
    if (second.kind !== "alert") throw new Error("expected an alert");
    expect(second.incidentId).not.toBe(first.incidentId);
  });

  it("never merges alerts that have no position: each is its own incident", async () => {
    const { db, send } = await setup();
    await send({ at: 0, geohash: null, from: "+213550000001" });
    await send({ at: 1, geohash: null, from: "+213550000002" });
    await send({ at: 1, from: "+213550000003" }); // with a position, but not matched to the positionless ones
    expect(await listIncidents(db)).toHaveLength(3);
  });

  it("turns 5 concurrent alerts about the same crash into one incident", async () => {
    const { db, send } = await setup();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => send({ at: 0, from: `+21355000000${n}`, victims: n })),
    );
    const ids = new Set(results.map((r) => (r.kind === "alert" ? r.incidentId : "none")));
    expect(ids.size).toBe(1);
    const incidents = await listIncidents(db);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ alertCount: 5, estimatedVictims: 5 });
    expect(results.filter((r) => r.kind === "alert" && r.merged)).toHaveLength(4);
  });

  it("still counts an identical SMS as a duplicate after other alerts have merged into the incident", async () => {
    const { db, send } = await setup();
    const first = await send({ at: 0, from: "+213550000001" });
    await send({ at: 1, from: "+213550000002" }); // a second witness merges
    const again = await send({ at: 0, from: "+213550000001" }); // the first witness's SMS is retried
    if (first.kind !== "alert" || again.kind !== "alert") throw new Error("expected alerts");

    expect(again.duplicate).toBe(true);
    expect(again.incidentId).toBe(first.incidentId);
    expect(again.ack).toBe(first.ack);
    expect((await listIncidents(db))[0]).toMatchObject({ alertCount: 2 });
  });

  it("lets incidents that are being handled absorb new alerts, but not finished ones", async () => {
    for (const status of ["dispatched", "on_scene", "transporting"] as const) {
      const { db, send } = await setup();
      const first = await send({ at: 0, from: "+213550000001" });
      if (first.kind !== "alert") throw new Error("expected an alert");
      await db.update(masterIncidents).set({ status }).where(eq(masterIncidents.id, first.incidentId));
      const second = await send({ at: 2, from: "+213550000002" });
      expect(second.kind === "alert" && second.incidentId, status).toBe(first.incidentId);
    }
    for (const status of ["handed_over", "false_alarm", "closed"] as const) {
      const { db, send } = await setup();
      const first = await send({ at: 0, from: "+213550000001" });
      if (first.kind !== "alert") throw new Error("expected an alert");
      await db.update(masterIncidents).set({ status }).where(eq(masterIncidents.id, first.incidentId));
      const second = await send({ at: 2, from: "+213550000002" });
      expect(second.kind === "alert" && second.incidentId, status).not.toBe(first.incidentId);
    }
  });

  it("tells dispatchers about a new incident even if recording the SMS result fails afterwards", async () => {
    const { db, events } = await setup();
    const stream = events.stream();
    await stream.next(); // ready

    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "update") {
          return () => {
            throw new Error("log write failed");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(ingestSms({ db: flaky, events }, report({ at: 0 }))).rejects.toThrow("log write failed");

    const next = await Promise.race([
      stream.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no event was published")), 1000)),
    ]);
    expect(next.value?.event.type).toBe("incident.created");
    await stream.return(undefined);
  });
});
