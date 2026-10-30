import { createTestDb } from "@solvex-dergana/db/testing";
import { incidentEvents } from "@solvex-dergana/db/schema/index";
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
  const sentSms: { to: string; body: string; incidentId?: string }[] = [];
  const smsTransport = {
    kind: "emulator" as const,
    async send(to: string, body: string, meta?: { incidentId?: string }) {
      sentSms.push({ to, body, incidentId: meta?.incidentId });
    },
  };
  const ctx = {
    db,
    events,
    smsTransport,
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
  return { db, events, caller, send, sentSms };
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
    const list = await caller.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.hasEscalation).toBe(false);
  });

  it("flags an incident with hasEscalation when an escalation suggestion exists (FR-S5-07)", async () => {
    const { db, caller, send } = await setup();
    const sent = await send(1);
    if (sent.kind !== "alert") throw new Error("expected an alert");

    await db.insert(incidentEvents).values({
      incidentId: sent.incidentId,
      actorRole: "system",
      type: "incident.escalation_suggested",
      payload: { from: "yellow", to: "red", reasons: [{ fr: "Nouvelle alerte grave", ar: "تنبيه خطير جديد" }] },
    });

    const list = await caller.list();
    expect(list[0]?.hasEscalation).toBe(true);
    expect(list[0]?.escalationTo).toBe("red");
  });
});

describe("incidents.byId (the evaluation card)", () => {
  it("returns the recommendation with reasons, authority reason and notification status", async () => {
    const { caller, send } = await setup();
    const sent = await send(3); // 3 victims: RED (FR-S2-15)
    if (sent.kind !== "alert") throw new Error("expected an alert");

    const card = await caller.byId({ id: sent.incidentId });

    expect(card).toMatchObject({ id: sent.incidentId, recSeverity: "red" });
    expect(card?.reasons).toEqual([{ fr: "3 victimes ou plus", ar: "3 ضحايا أو أكثر" }]);
    expect(card?.recUnits).toEqual([expect.objectContaining({ type: "vsav_standard", count: 1 })]);
    expect(card?.authorityReason).toBeTypeOf("string");
    expect(card?.authorityNotification).toBeNull();
  });

  it("returns null for an incident that does not exist", async () => {
    const { caller } = await setup();
    expect(await caller.byId({ id: "00000000-0000-4000-8000-00000000dead" })).toBeNull();
  });

  it("refuses medics and hospital staff", async () => {
    for (const role of ["medic", "hospital"] as const) {
      const { caller } = await setup({ role });
      await expect(caller.byId({ id: "00000000-0000-4000-8000-00000000dead" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });
});

describe("incidents.notifyAuthority (FR-S5-05)", () => {
  it("sends an SMS summary to the routed authority, logs it, and marks notification", async () => {
    const { caller, send, sentSms } = await setup();
    const stream = (await caller.onChange({}))[Symbol.asyncIterator]();
    await stream.next(); // ready marker

    const sent = await send(2);
    if (sent.kind !== "alert") throw new Error("expected alert");
    await stream.next(); // incident.created

    const res = await caller.notifyAuthority({ incidentId: sent.incidentId });
    expect(res).toMatchObject({
      ok: true,
      authority: "gendarmerie_nationale",
      phone: "1055",
      notifiedAt: expect.any(String),
    });

    // SMS sent via transport
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0]?.to).toBe("1055");
    expect(sentSms[0]?.body).toContain("SVX ALERTE");
    expect(sentSms[0]?.incidentId).toBe(sent.incidentId);

    // Card reflects notification
    const card = await caller.byId({ id: sent.incidentId });
    expect(card?.authorityNotification).toMatchObject({
      authority: "gendarmerie_nationale",
      phone: "1055",
      notifiedAt: res.notifiedAt,
    });

    // Event emitted on bus
    const eventItem = unwrap((await stream.next()).value);
    expect(eventItem.event).toMatchObject({
      type: "incident.updated",
      incident: { id: sent.incidentId },
    });
    await stream.return?.(undefined);
  });

  it("refuses medics and hospital staff", async () => {
    for (const role of ["medic", "hospital"] as const) {
      const { caller } = await setup({ role });
      await expect(caller.notifyAuthority({ incidentId: "00000000-0000-4000-8000-00000000dead" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });

  it("fails with NOT_FOUND if incident does not exist", async () => {
    const { caller } = await setup();
    await expect(caller.notifyAuthority({ incidentId: "00000000-0000-4000-8000-00000000dead" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
