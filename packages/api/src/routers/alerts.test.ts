import { masterIncidents, rawAlerts } from "@solvex-dergana/db/schema/index";
import { createTestDb } from "@solvex-dergana/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { Context } from "../context";
import { appRouter } from "./index";
import { createEventBus, type DispatcherEvent } from "../services/events";

const testDatabases: Awaited<ReturnType<typeof createTestDb>>[] = [];
afterEach(async () => {
  for (const db of testDatabases.splice(0)) {
    await (
      db as unknown as { $client: { close(): Promise<void> } }
    ).$client.close();
  }
});

function makeCaller(
  db: Awaited<ReturnType<typeof createTestDb>>,
  events = createEventBus(),
) {
  const ctx: Context = {
    session: null,
    appUser: null,
    db,
    events,
    smsTransport: { kind: "emulator", send: async () => {} },
  };
  return appRouter.createCaller(ctx);
}

describe("alertsRouter.submitOnline (Seam 1)", () => {
  it("creates a new incident and raw_alert from witness 3-tap report with GPS", async () => {
    const db = await createTestDb();
    testDatabases.push(db);
    const bus = createEventBus();
    const published: DispatcherEvent[] = [];
    const origPublish = bus.publish.bind(bus);
    bus.publish = ((e: any, ch: any) => {
      published.push(e);
      return origPublish(e, ch);
    }) as any;
    const caller = makeCaller(db, bus);

    const idempotencyKey = "client-uuid-12345";
    const res = await caller.alerts.submitOnline({
      idempotencyKey,
      victims: 2,
      conscious: 1,
      fire: false,
      trapped: true,
      bleeding: false,
      lat: 36.725,
      lng: 3.183,
      accuracyM: 15,
    });

    expect(res).toEqual({
      alertId: expect.any(String),
      incidentId: expect.any(String),
      duplicate: false,
      merged: false,
    });

    // Check stored raw_alert
    const [alert] = await db
      .select()
      .from(rawAlerts)
      .where(eq(rawAlerts.id, res.alertId));
    expect(alert).toBeDefined();
    expect(alert!.source).toBe("app_witness");
    expect(alert!.channel).toBe("internet");
    expect(alert!.victims).toBe(2);
    expect(alert!.conscious).toBe(1);
    expect(alert!.trapped).toBe(true);
    expect(alert!.fire).toBe(false);
    expect(alert!.bleeding).toBe(false);
    expect(alert!.lat).toBeCloseTo(36.725, 4);
    expect(alert!.lng).toBeCloseTo(3.183, 4);
    expect(alert!.incidentId).toBe(res.incidentId);

    // Check master_incident
    const [incident] = await db
      .select()
      .from(masterIncidents)
      .where(eq(masterIncidents.id, res.incidentId));
    expect(incident).toBeDefined();
    expect(incident!.estimatedVictims).toBe(2);
    expect(incident!.alertCount).toBe(1);

    // Event broadcast
    const createdEvent = published.find((e) => e.type === "incident.created");
    expect(createdEvent).toBeDefined();
  });

  it("is idempotent: duplicate idempotencyKey returns duplicate flag and same incidentId", async () => {
    const db = await createTestDb();
    testDatabases.push(db);
    const caller = makeCaller(db);

    const idempotencyKey = "unique-witness-key-999";
    const first = await caller.alerts.submitOnline({
      idempotencyKey,
      victims: 1,
      conscious: 0,
      fire: true,
      trapped: false,
      bleeding: true,
      lat: 36.7538,
      lng: 3.0588,
      accuracyM: 10,
    });

    expect(first.duplicate).toBe(false);

    // Repeat with identical idempotencyKey
    const second = await caller.alerts.submitOnline({
      idempotencyKey,
      victims: 1,
      conscious: 0,
      fire: true,
      trapped: false,
      bleeding: true,
      lat: 36.7538,
      lng: 3.0588,
      accuracyM: 10,
    });

    expect(second.duplicate).toBe(true);
    expect(second.incidentId).toBe(first.incidentId);
    expect(second.alertId).toBe(first.alertId);
  });

  it("stores manual PK marker and commune when GPS is null", async () => {
    const db = await createTestDb();
    testDatabases.push(db);
    const caller = makeCaller(db);

    const res = await caller.alerts.submitOnline({
      idempotencyKey: "manual-location-alert-001",
      victims: 3,
      conscious: 2,
      fire: false,
      trapped: false,
      bleeding: false,
      lat: null,
      lng: null,
      accuracyM: null,
      commune: "Bab Ezzouar",
      pkMarker: "RN5 PK 14+200",
    });

    expect(res.incidentId).toBeDefined();

    const [incident] = await db
      .select()
      .from(masterIncidents)
      .where(eq(masterIncidents.id, res.incidentId));
    expect(incident!.commune).toBe("Bab Ezzouar");
    expect(incident!.pkMarker).toBe("RN5 PK 14+200");
  });

  it("merges into existing incident when reported within clustering threshold", async () => {
    const db = await createTestDb();
    testDatabases.push(db);
    const bus = createEventBus();
    const published: DispatcherEvent[] = [];
    const origPublish = bus.publish.bind(bus);
    bus.publish = ((e: any, ch: any) => {
      published.push(e);
      return origPublish(e, ch);
    }) as any;
    const caller = makeCaller(db, bus);

    // First alert establishes the incident
    const first = await caller.alerts.submitOnline({
      idempotencyKey: "first-witness-alert",
      victims: 1,
      conscious: 1,
      fire: false,
      trapped: false,
      bleeding: false,
      lat: 36.7250,
      lng: 3.1830,
      accuracyM: 10,
    });
    expect(first.merged).toBe(false);

    // Second alert from another witness nearby (~20m away)
    const second = await caller.alerts.submitOnline({
      idempotencyKey: "second-witness-alert",
      victims: 2,
      conscious: 0,
      fire: true,
      trapped: true,
      bleeding: true,
      lat: 36.7251,
      lng: 3.1831,
      accuracyM: 10,
    });

    expect(second.merged).toBe(true);
    expect(second.incidentId).toBe(first.incidentId);

    const updatedEvent = published.find((e) => e.type === "incident.updated");
    expect(updatedEvent).toBeDefined();
  });

  it("creates a raw_alert with source 'app_auto' when submitted by automatic phone crash detection", async () => {
    const db = await createTestDb();
    testDatabases.push(db);
    const bus = createEventBus();
    const caller = makeCaller(db, bus);

    const idempotencyKey = "phone-auto-crash-999";
    const res = await caller.alerts.submitOnline({
      idempotencyKey,
      source: "app_auto",
      victims: 1,
      conscious: null,
      fire: false,
      trapped: false,
      bleeding: false,
      lat: 36.75,
      lng: 3.05,
      accuracyM: 8,
    });

    expect(res.alertId).toBeDefined();
    expect(res.incidentId).toBeDefined();

    const [alert] = await db
      .select()
      .from(rawAlerts)
      .where(eq(rawAlerts.id, res.alertId));
    expect(alert).toBeDefined();
    expect(alert!.source).toBe("app_auto");
  });

  it("submits emulated SVX SMS via alerts.submitSms, creates an incident with channel 'sms' and returns SVXACK (FR-S4-06)", async () => {
    const db = await createTestDb();
    testDatabases.push(db);
    const bus = createEventBus();
    const caller = makeCaller(db, bus);

    // Build a valid SVX string
    // SVX1#L:2#GH:spey52b7#T:10q3z#V:2#C:1#TR:1#CK:xx
    const { buildWitnessSvxString } = await import("@solvex-dergana/shared");
    const { svx } = buildWitnessSvxString({
      victims: 2,
      conscious: 1,
      fire: false,
      trapped: true,
      bleeding: false,
      lat: 36.75,
      lng: 3.05,
      timestamp: 1793361600000,
    });

    const res = await caller.alerts.submitSms({
      from: "+213550000123",
      body: svx,
      emulated: true,
    });

    expect(res).toBeDefined();
    expect(res.kind).toBe("alert");
    if (res.kind === "alert") {
      expect(res.ack).toMatch(/^SVXACK#[0-9A-F]+$/);
      expect(res.incidentId).toBeDefined();

      const [stored] = await db
        .select()
        .from(rawAlerts)
        .where(eq(rawAlerts.incidentId, res.incidentId));
      expect(stored).toBeDefined();
      expect(stored!.channel).toBe("sms");
      expect(stored!.emulated).toBe(true);
      expect(stored!.source).toBe("app_witness");
    }
  });
});


