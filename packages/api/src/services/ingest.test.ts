import { createTestDb } from "@solvex-dergana/db/testing";
import { encodeSvx, type SvxAlert } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { createEventBus } from "./events";
import { getIncident, listIncidents, listUnlinkedAlerts } from "./incidents";
import { ingestSms } from "./ingest";
import { listWireLog } from "./wire";

// 2026-10-30T09:00:00Z, the reference time used in test-vectors/svx.json.
const EVENT_MINUTES = 29889180;
const RECEIVED_AT = new Date("2026-10-30T09:01:00Z");
const SENDER = "+213550000001";

const witnessAlert: SvxAlert = {
  layer: 2,
  geohash: "sn2j5x7k",
  eventMinutes: EVENT_MINUTES,
  peakG: null,
  rollover: null,
  fire: false,
  victims: 2,
  conscious: 1,
  trapped: true,
  bleeding: false,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
};

describe("ingestSms: a valid SVX alert", () => {
  it("becomes one open incident with its raw alert, and is acknowledged", async () => {
    const db = await createTestDb();
    const body = encodeSvx(witnessAlert);

    const result = await ingestSms(
      { db, events: createEventBus() },
      { from: SENDER, body, receivedAt: RECEIVED_AT, emulated: true },
    );

    if (result.kind !== "alert") throw new Error(`expected an alert, got ${result.kind}`);
    // The ack is "SVXACK#" followed by 8 hexadecimal characters (a stable reference for the sender).
    expect(result.ack).toMatch(/^SVXACK#[0-9A-F]{8}$/);
    expect(result.duplicate).toBe(false);

    const incidents = await listIncidents(db);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      id: result.incidentId,
      status: "open",
      recSeverity: "unknown",
      alertCount: 1,
      geohash8: "sn2j5x7k",
      estimatedVictims: 2,
    });

    const detail = await getIncident(db, result.incidentId);
    expect(detail?.alerts).toHaveLength(1);
    expect(detail?.alerts[0]).toMatchObject({
      source: "app_witness",
      channel: "sms",
      rawPayload: body,
      emulated: true,
      geohash: "sn2j5x7k",
      victims: 2,
      conscious: 1,
      fire: false,
      trapped: true,
      bleeding: false,
      parseErrors: [],
    });
  });
});

describe("ingestSms: the SMS log (what the console wire log reads)", () => {
  it("records the inbound SMS with its size, emulation flag and decode result", async () => {
    const db = await createTestDb();
    const body = encodeSvx(witnessAlert);

    const result = await ingestSms(
      { db, events: createEventBus() },
      { from: SENDER, body, receivedAt: RECEIVED_AT, emulated: true },
    );
    if (result.kind !== "alert") throw new Error("expected an alert");

    const wire = await listWireLog(db);
    expect(wire).toHaveLength(1);
    expect(wire[0]).toMatchObject({
      direction: "in",
      emulated: true,
      body,
      size: body.length,
      status: "received",
      incidentId: result.incidentId,
      result: { recognized: true, crcValid: true, parseErrors: [] },
    });
    // The phone number itself is never stored or shown, only a hash.
    expect(JSON.stringify(wire[0])).not.toContain(SENDER);
  });
});

describe("ingestSms: a corrupted SMS is never dropped (NFR-P6)", () => {
  it("still opens an incident when the checksum is wrong, and flags it", async () => {
    const db = await createTestDb();
    // Payload changed in transit: victims 2 became 5 but the checksum is the old one.
    const corrupted = encodeSvx(witnessAlert).replace("#V:2#", "#V:5#");

    const result = await ingestSms(
      { db, events: createEventBus() },
      { from: SENDER, body: corrupted, receivedAt: RECEIVED_AT, emulated: true },
    );
    if (result.kind !== "alert") throw new Error("expected an alert");

    const detail = await getIncident(db, result.incidentId);
    expect(detail?.alerts[0]).toMatchObject({ victims: 5, parseErrors: ["bad_crc"] });
    expect((await listWireLog(db))[0]?.result).toMatchObject({
      recognized: true,
      crcValid: false,
      parseErrors: ["bad_crc"],
    });
  });
});

describe("ingestSms: duplicates", () => {
  it("does not create a second incident or alert for the same SMS from the same sender, and re-acks it", async () => {
    const db = await createTestDb();
    const body = encodeSvx(witnessAlert);
    const first = await ingestSms(
      { db, events: createEventBus() }, { from: SENDER, body, receivedAt: RECEIVED_AT, emulated: true });
    const second = await ingestSms(
      { db, events: createEventBus() },
      { from: SENDER, body, receivedAt: new Date("2026-10-30T09:02:00Z"), emulated: true },
    );
    if (first.kind !== "alert" || second.kind !== "alert") throw new Error("expected alerts");

    expect(second.duplicate).toBe(true);
    expect(second.incidentId).toBe(first.incidentId);
    expect(second.ack).toBe(first.ack);
    expect(await listIncidents(db)).toHaveLength(1);
    expect((await getIncident(db, first.incidentId))?.alerts).toHaveLength(1);

    // Both SMS are on the wire log; the second one is marked as a duplicate.
    const wire = await listWireLog(db);
    expect(wire).toHaveLength(2);
    expect(wire.filter((w) => w.result?.duplicate === true)).toHaveLength(1);
  });

  it("treats the same text from a different sender as a separate report", async () => {
    const db = await createTestDb();
    const body = encodeSvx(witnessAlert);
    const a = await ingestSms(
      { db, events: createEventBus() }, { from: SENDER, body, receivedAt: RECEIVED_AT, emulated: true });
    const b = await ingestSms(
      { db, events: createEventBus() }, { from: "+213550000002", body, receivedAt: RECEIVED_AT, emulated: true });
    if (a.kind !== "alert" || b.kind !== "alert") throw new Error("expected alerts");

    expect(b.duplicate).toBe(false);
    expect(b.incidentId).not.toBe(a.incidentId);
    expect(await listIncidents(db)).toHaveLength(2);
  });
});

describe("ingestSms: text that is not an SVX alert", () => {
  it("is kept on record without opening an incident, and gets no ack", async () => {
    const db = await createTestDb();
    const text = "Bonjour, accident a Rouiba";

    const result = await ingestSms(
      { db, events: createEventBus() },
      { from: SENDER, body: text, receivedAt: RECEIVED_AT, emulated: true },
    );

    expect(result).toEqual({ kind: "ignored", reason: "not_svx" });
    expect(await listIncidents(db)).toEqual([]);

    const unlinked = await listUnlinkedAlerts(db);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({
      source: "unknown",
      channel: "sms",
      rawPayload: text,
      parseErrors: ["not_svx"],
      incidentId: null,
    });
    expect((await listWireLog(db))[0]?.result).toMatchObject({
      recognized: false,
      parseErrors: ["not_svx"],
    });
  });
});

describe("ingestSms: concurrency and failures (review findings)", () => {
  it("handles two identical SMS arriving at the same moment: one incident, both acked, nothing left half-done", async () => {
    const db = await createTestDb();
    const body = encodeSvx(witnessAlert);
    const sms = { from: SENDER, body, receivedAt: RECEIVED_AT, emulated: true };
    const events = createEventBus();

    const [a, b] = await Promise.all([ingestSms({ db, events }, sms), ingestSms({ db, events }, sms)]);
    if (a.kind !== "alert" || b.kind !== "alert") throw new Error("expected alerts");

    expect(a.incidentId).toBe(b.incidentId);
    expect(a.ack).toBe(b.ack);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(await listIncidents(db)).toHaveLength(1);
    // Both SMS are on the wire log with a verdict; none is stuck as "received" with no result.
    const wire = await listWireLog(db);
    expect(wire).toHaveLength(2);
    expect(wire.every((w) => w.result !== null)).toBe(true);
  });

  it("marks the SMS as failed on the wire log (and rethrows) when processing breaks", async () => {
    const db = await createTestDb();
    const broken = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") return () => Promise.reject(new Error("database is down"));
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(
      ingestSms(
        { db: broken, events: createEventBus() },
        { from: SENDER, body: encodeSvx(witnessAlert), receivedAt: RECEIVED_AT, emulated: true },
      ),
    ).rejects.toThrow("database is down");

    const wire = await listWireLog(db);
    expect(wire).toHaveLength(1);
    expect(wire[0]).toMatchObject({ direction: "in", status: "failed" });
  });
});

describe("incidents carry the honesty flag (NFR-P5)", () => {
  it("marks an incident as emulated when it came from the emulated GSM network, and not otherwise", async () => {
    const db = await createTestDb();
    const events = createEventBus();
    const body = encodeSvx(witnessAlert);
    const emulated = await ingestSms({ db, events }, { from: SENDER, body, receivedAt: RECEIVED_AT, emulated: true });
    const real = await ingestSms({ db, events }, { from: "+213550000002", body, receivedAt: RECEIVED_AT, emulated: false });
    if (emulated.kind !== "alert" || real.kind !== "alert") throw new Error("expected alerts");

    const byId = new Map((await listIncidents(db)).map((i) => [i.id, i]));
    expect(byId.get(emulated.incidentId)?.emulated).toBe(true);
    expect(byId.get(real.incidentId)?.emulated).toBe(false);
  });
});
