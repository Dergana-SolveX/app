import {
  medicalProfiles,
  masterIncidents,
  ambulanceUnits,
  hospitalsMatrix,
  zones,
} from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";
import { createTestDb } from "@solvex-dergana/db/testing";
import { encodeSvx, type SvxAlert } from "@solvex-dergana/shared";
import { afterEach, describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { t } from "../index";
import { createEventBus, type DispatcherEvent } from "../services/events";
import { ingestSms } from "../services/ingest";
import { incidentsRouter } from "./incidents";

// Each report comes from a different, far-away place, so each one opens its own incident.
const PLACES = ["snd2bmtf", "snd2brmy", "snd1jdg6", "snd2vrp3"];

const makeAlert = (victims: number, place = victims): SvxAlert => ({
  layer: 2,
  geohash: PLACES[place % PLACES.length]!,
  eventMinutes: 29889180,
  peakG: null,
  rollover: null,
  fire: false,
  victims,
  conscious: 1,
  trapped: false,
  bleeding: false,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
});

const appUser = (role: AppUserContext["role"]): AppUserContext => ({
  id: "u1",
  role,
  unitId: null,
  hospitalId: null,
});

const testDatabases: Awaited<ReturnType<typeof createTestDb>>[] = [];
afterEach(async () => {
  for (const db of testDatabases.splice(0)) {
    await (
      db as unknown as { $client: { close(): Promise<void> } }
    ).$client.close();
  }
});

async function setup(
  options: { bufferSize?: number; role?: AppUserContext["role"] } = {},
) {
  const db = await createTestDb();
  testDatabases.push(db);
  const events = createEventBus({ bufferSize: options.bufferSize });
  const ctx = {
    db,
    events,
    session: { user: { id: "auth-1" } },
    appUser: appUser(options.role ?? "dispatcher"),
  } as unknown as Context;
  const caller = t.createCallerFactory(incidentsRouter)(ctx);
  const send = (n: number, place = n) =>
    ingestSms(
      { db, events },
      {
        from: `+21355000000${n}`,
        body: encodeSvx(makeAlert(n, place)),
        emulated: true,
      },
    );
  return { db, events, caller, send };
}

/** A stream item as the server-side caller sees it: a `[id, event]` envelope made by `tracked()`. */
const unwrap = (item: unknown) => {
  const [id, event] = item as [string, DispatcherEvent];
  return { id, event };
};

/** Pulls the next `count` items from a subscription, failing instead of hanging. */
async function take<T>(
  iterable: AsyncIterable<T>,
  count: number,
): Promise<T[]> {
  const it = iterable[Symbol.asyncIterator]();
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const next = await Promise.race([
      it.next(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("timed out waiting for an event")),
          2000,
        ),
      ),
    ]);
    if (next.done) break;
    out.push(next.value);
  }
  await it.return?.(undefined);
  return out;
}

describe("incidents.onChange (the dispatcher live stream)", () => {
  it("starts with a ready marker, then delivers each new incident", async () => {
    const { caller, send } = await setup();
    const stream = await caller.onChange({});
    const it = stream[Symbol.asyncIterator]();

    const ready = await it.next();
    expect(unwrap(ready.value).event).toMatchObject({ type: "ready" });

    const result = await send(1);
    if (result.kind !== "alert") throw new Error("expected an alert");

    const created = await it.next();
    expect(unwrap(created.value).event).toMatchObject({
      type: "incident.created",
      incident: { id: result.incidentId, status: "open" },
    });
    await it.return?.(undefined);
  });

  it("replays what a reconnecting client missed, in order, without a resync", async () => {
    const { caller, send } = await setup();
    const [ready] = await take(await caller.onChange({}), 1);
    const lastEventId = unwrap(ready).id;

    // Two incidents arrive while the client is disconnected.
    const a = await send(1);
    const b = await send(2);
    if (a.kind !== "alert" || b.kind !== "alert")
      throw new Error("expected alerts");

    const replayed = (
      await take(await caller.onChange({ lastEventId }), 2)
    ).map(unwrap);
    expect(replayed.map((r) => r.event.type)).toEqual([
      "incident.created",
      "incident.created",
    ]);
    expect(
      replayed.map(
        (r) => (r.event as { incident: { id: string } }).incident.id,
      ),
    ).toEqual([a.incidentId, b.incidentId]);
  });

  it("asks for a resync when the id comes from another run of the server", async () => {
    const { caller } = await setup();
    const [first] = (
      await take(await caller.onChange({ lastEventId: "some-other-boot:7" }), 1)
    ).map(unwrap);
    expect(first?.event).toEqual({ type: "resync" });
  });

  it("asks for a resync when the missed events are no longer in the buffer", async () => {
    const { caller, send } = await setup({ bufferSize: 2 });
    const [ready] = await take(await caller.onChange({}), 1);
    const lastEventId = unwrap(ready).id;

    await send(1);
    await send(2);
    await send(3); // the first one has now been pushed out of the 2-event buffer

    const [first] = (await take(await caller.onChange({ lastEventId }), 1)).map(
      unwrap,
    );
    expect(first?.event).toEqual({ type: "resync" });
  });
});

describe("incidents.onChange: merged alerts", () => {
  it("announces an alert that joins an existing incident as an update, with the new count", async () => {
    const { caller, send } = await setup();
    const stream = (await caller.onChange({}))[Symbol.asyncIterator]();
    await stream.next(); // ready

    const first = await send(1, 0);
    await stream.next(); // incident.created
    const second = await send(2, 0); // the same place and time: the same crash
    if (first.kind !== "alert" || second.kind !== "alert")
      throw new Error("expected alerts");

    const update = unwrap((await stream.next()).value);
    expect(update.event).toMatchObject({
      type: "incident.updated",
      incident: { id: first.incidentId, alertCount: 2 },
    });
    await stream.return?.(undefined);
  });
});

describe("incidents access control", () => {
  it("lets dispatchers and the admin list incidents", async () => {
    for (const role of ["dispatcher", "admin"] as const) {
      const { caller } = await setup({ role });
      expect(await caller.list()).toEqual([]);
    }
  });

  it("refuses medics and hospital staff, for the list and the stream", async () => {
    for (const role of ["medic", "hospital"] as const) {
      const { caller } = await setup({ role });
      await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.onChange({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });

  it("lists the incidents a dispatcher can see after an SMS arrives", async () => {
    const { caller, send } = await setup();
    await send(1);
    expect(await caller.list()).toHaveLength(1);
  });
});

describe("dispatcher incident details", () => {
  it("opens an incident with its original signals and journal", async () => {
    const { caller, send } = await setup();
    const sent = await send(1);
    if (sent.kind !== "alert") throw new Error("expected alert");
    const detail = await caller.byId({ id: sent.incidentId });
    expect(detail.alerts).toEqual([
      expect.objectContaining({
        source: "app_witness",
        channel: "sms",
        emulated: true,
        rawPayload: encodeSvx(makeAlert(1)),
      }),
    ]);
    expect(detail.journal).toEqual(expect.any(Array));
  });
});

it("marks a false alarm, records the dispatcher and publishes the change", async () => {
  const { caller, send } = await setup();
  const sent = await send(1);
  if (sent.kind !== "alert") throw new Error("expected alert");
  const stream = (await caller.onChange({}))[Symbol.asyncIterator]();
  await stream.next();
  await caller.markFalseAlarm({
    id: sent.incidentId,
    version: 1,
    reason: "Appel confirmé sans accident",
  });
  const detail = await caller.byId({ id: sent.incidentId });
  expect(detail).toMatchObject({
    status: "false_alarm",
    version: 2,
    alerts: [expect.any(Object)],
  });
  expect(detail.journal).toContainEqual(
    expect.objectContaining({
      type: "incident.false_alarm",
      actorId: "u1",
      payload: expect.objectContaining({
        reason: "Appel confirmé sans accident",
      }),
    }),
  );
  expect(unwrap((await stream.next()).value).event).toMatchObject({
    type: "incident.updated",
    incident: { status: "false_alarm" },
  });
  await stream.return?.(undefined);
});

it("splits selected signals into a new incident without losing evidence", async () => {
  const { caller, send } = await setup();
  const sent = await send(1, 0);
  await send(2, 0);
  if (sent.kind !== "alert") throw new Error("expected alert");
  const before = await caller.byId({ id: sent.incidentId });
  const selected = before.alerts.find((a) => a.victims === 2)!;
  const result = await caller.split({
    id: sent.incidentId,
    version: before.version,
    alertIds: [selected.id],
    reason: "Deux accidents distincts",
  });
  const source = await caller.byId({ id: sent.incidentId });
  const created = await caller.byId({ id: result.id });
  expect(source).toMatchObject({ alertCount: 1, estimatedVictims: 1 });
  expect(created).toMatchObject({
    alertCount: 1,
    estimatedVictims: 2,
    alerts: [
      expect.objectContaining({
        id: selected.id,
        rawPayload: selected.rawPayload,
      }),
    ],
  });
  expect(source.journal).toContainEqual(
    expect.objectContaining({ type: "incident.split", actorId: "u1" }),
  );
  expect(created.journal).toContainEqual(
    expect.objectContaining({ type: "incident.split" }),
  );
});

it("merges incidents into the chosen target and keeps both audit trails", async () => {
  const { caller, send } = await setup();
  const a = await send(1);
  const b = await send(2);
  if (a.kind !== "alert" || b.kind !== "alert")
    throw new Error("expected alerts");
  await caller.merge({
    sourceId: a.incidentId,
    targetId: b.incidentId,
    sourceVersion: 1,
    targetVersion: 1,
    reason: "Même accident confirmé",
  });
  const target = await caller.byId({ id: b.incidentId });
  const source = await caller.byId({ id: a.incidentId });
  expect(target).toMatchObject({ alertCount: 2, estimatedVictims: 2 });
  expect(target.alerts).toHaveLength(2);
  expect(source).toMatchObject({ status: "closed", alertCount: 0, alerts: [] });
  for (const detail of [source, target])
    expect(detail.journal).toContainEqual(
      expect.objectContaining({
        type: "incident.merged",
        payload: expect.objectContaining({
          sourceId: a.incidentId,
          targetId: b.incidentId,
        }),
      }),
    );
});

it("rejects corrections of closed incidents without moving their signals", async () => {
  const { caller, send } = await setup();
  const a = await send(1);
  const b = await send(2);
  if (a.kind !== "alert" || b.kind !== "alert")
    throw new Error("expected alerts");
  await caller.markFalseAlarm({
    id: a.incidentId,
    version: 1,
    reason: "Vérifié",
  });
  await expect(
    caller.merge({
      sourceId: a.incidentId,
      targetId: b.incidentId,
      sourceVersion: 2,
      targetVersion: 1,
      reason: "Fusion",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await caller.byId({ id: a.incidentId })).alerts).toHaveLength(1);
});

it("logs each access before returning linked medical risks", async () => {
  const { db, caller, send } = await setup();
  const sent = await send(1);
  if (sent.kind !== "alert") throw new Error("expected alert");
  const [profile] = await db
    .insert(medicalProfiles)
    .values({
      shortCode: "TEST0001",
      fullName: "Patient test",
      birthDate: "1970-01-01",
      sex: "male",
      consentAt: new Date(),
      bloodType: "O+",
      allergies: ["Pénicilline"],
      medications: [
        { name: "Traitement A", class: "anticoagulant" },
        { name: "Traitement B", class: "beta_blocker" },
      ],
    })
    .returning();
  await db
    .update(masterIncidents)
    .set({ linkedProfileIds: [profile!.id] })
    .where(eq(masterIncidents.id, sent.incidentId));
  for (let n = 0; n < 2; n++) {
    const profiles = await caller.profiles({ id: sent.incidentId });
    expect(profiles).toEqual([
      expect.objectContaining({
        bloodType: "O+",
        allergies: ["Pénicilline"],
        anticoagulant: true,
        unreliableShockIndex: true,
      }),
    ]);
    expect(profiles[0]).not.toHaveProperty("fullName");
  }
  const detail = await caller.byId({ id: sent.incidentId });
  expect(
    detail.journal.filter((e) => e.type === "profile.accessed"),
  ).toHaveLength(2);
  expect(detail.journal).toContainEqual(
    expect.objectContaining({
      actorId: "u1",
      payload: { profileIds: [profile!.id] },
    }),
  );
});

it("returns units hospitals and jurisdiction polygons for the dispatcher map", async () => {
  const { db, caller } = await setup();
  await db
    .insert(ambulanceUnits)
    .values({
      callSign: "VSAV-01",
      type: "vsav_standard",
      baseName: "Alger",
      lat: 36.7,
      lng: 3.1,
    });
  await db
    .insert(hospitalsMatrix)
    .values({
      name: "Hôpital test",
      shortName: "HT",
      tier: "chu",
      commune: "Alger",
      wilaya: "Alger",
      lat: 36.71,
      lng: 3.11,
    });
  const polygon = {
    type: "Polygon" as const,
    coordinates: [
      [
        [3, 36],
        [4, 36],
        [4, 37],
        [3, 36],
      ],
    ],
  };
  await db.insert(zones).values({ name: "Zone urbaine", polygon });
  const map = await caller.mapLayers();
  expect(map.units).toEqual([
    expect.objectContaining({ callSign: "VSAV-01", available: true }),
  ]);
  expect(map.hospitals).toEqual([
    expect.objectContaining({ shortName: "HT", lat: 36.71 }),
  ]);
  expect(map.zones).toEqual([
    expect.objectContaining({ name: "Zone urbaine", polygon }),
  ]);
});

it("rejects stale corrections after another alert arrives", async () => {
  const { caller, send } = await setup();
  const a = await send(1, 0);
  if (a.kind !== "alert") throw new Error("expected alert");
  await send(2, 0);
  await expect(
    caller.markFalseAlarm({
      id: a.incidentId,
      version: 1,
      reason: "Ancienne vue",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await caller.byId({ id: a.incidentId })).status).toBe("open");
});

it.each(["medic", "hospital"] as const)(
  "denies %s access to dispatcher details and corrections",
  async (role) => {
    const { caller } = await setup({ role });
    const id = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    for (const request of [
      () => caller.byId({ id }),
      () => caller.profiles({ id }),
      () => caller.mapLayers(),
      () => caller.markFalseAlarm({ id, version: 1, reason: "Test" }),
      () => caller.split({ id, version: 1, alertIds: [other], reason: "Test" }),
      () =>
        caller.merge({
          sourceId: id,
          targetId: other,
          sourceVersion: 1,
          targetVersion: 1,
          reason: "Test",
        }),
    ])
      await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it("rejects a split containing foreign or all signals without partial writes", async () => {
  const { caller, send } = await setup();
  const a = await send(1);
  const b = await send(2);
  if (a.kind !== "alert" || b.kind !== "alert")
    throw new Error("expected alerts");
  const first = await caller.byId({ id: a.incidentId });
  const second = await caller.byId({ id: b.incidentId });
  for (const alertIds of [[first.alerts[0]!.id], [second.alerts[0]!.id]]) {
    await expect(
      caller.split({ id: a.incidentId, version: 1, alertIds, reason: "Test" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  expect(await caller.byId({ id: a.incidentId })).toEqual(first);
  expect(await caller.byId({ id: b.incidentId })).toEqual(second);
  expect(await caller.list()).toHaveLength(2);
});

it("does not reopen a completed incident by splitting its evidence", async () => {
  const { caller, send } = await setup();
  const a = await send(1, 0);
  await send(2, 0);
  if (a.kind !== "alert") throw new Error("expected alert");
  const before = await caller.byId({ id: a.incidentId });
  await caller.markFalseAlarm({
    id: before.id,
    version: before.version,
    reason: "Vérifié",
  });
  await expect(
    caller.split({
      id: before.id,
      version: before.version + 1,
      alertIds: [before.alerts[0]!.id],
      reason: "Test",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
