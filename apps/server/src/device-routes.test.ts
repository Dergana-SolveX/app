import { createEventBus } from "@solvex-dergana/api/services/events";
import { getIncident } from "@solvex-dergana/api/services/incidents";
import { createTestDb } from "@solvex-dergana/db/testing";
import { vehicles } from "@solvex-dergana/db/schema/index";
import {
  deriveDeviceKey,
  deviceKeyCheck,
  signDevicePayload,
} from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { createDeviceApp } from "./device-routes";

describe("Device endpoints (/devices/:deviceId/*)", () => {
  const MASTER_SECRET = "svx-device-master-secret-for-testing-32!";
  const DEVICE_ID = "SVX-CHIP-001";

  async function setup() {
    const db = await createTestDb();
    const events = createEventBus();
    const deviceKey = await deriveDeviceKey(MASTER_SECRET, DEVICE_ID);
    const secretHash = await deviceKeyCheck(deviceKey);

    const [vehicle] = await db
      .insert(vehicles)
      .values({
        deviceId: DEVICE_ID,
        deviceSecretHash: secretHash,
        simMsisdn: "+213550111222",
        makeModel: "Peugeot 301",
      })
      .returning();

    const app = createDeviceApp({
      masterDeviceSecret: MASTER_SECRET,
      db,
      events,
    });

    return { db, events, deviceKey, vehicle: vehicle!, app };
  }

  describe("POST /devices/:deviceId/heartbeat", () => {
    it(
      "updates vehicles row with lastHeartbeatAt, batteryMv, and lastTelemetry",
      async () => {
        const { app, db, deviceKey } = await setup();
        const now = Date.now();
        const telemetry = {
          deviceId: DEVICE_ID,
          t: now,
          g: 1.0,
          roll: 0.1,
          pitch: -0.2,
          state: "IDLE",
          gps: { fix: true, sats: 8, lat: 36.75, lng: 3.05 },
          signalDbm: -72,
          batteryPct: 85,
          batteryMv: 4050,
          vehicle12vOk: true,
          activeBlock: "esp32",
          demoArm: false,
        };

        const body = JSON.stringify(telemetry);
        const signature = await signDevicePayload(deviceKey, body);

        const res = await app.request(`/devices/${DEVICE_ID}/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SVX-Signature": signature,
            "X-SVX-Timestamp": String(now),
          },
          body,
        });

        expect(res.status).toBe(200);
        const json = (await res.json()) as { ok: boolean };
        expect(json.ok).toBe(true);

        const [updated] = await db.select().from(vehicles);
        expect(updated?.lastHeartbeatAt).toBeInstanceOf(Date);
        expect(updated?.batteryMv).toBe(4050);
        expect(updated?.lastTelemetry).toMatchObject({
          state: "IDLE",
          batteryPct: 85,
        });
      },
      15000,
    );

    it(
      "rejects request if timestamp is older than 5 minutes (replay protection)",
      async () => {
        const { app, deviceKey } = await setup();
        const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
        const body = JSON.stringify({ deviceId: DEVICE_ID, t: sixMinutesAgo });
        const signature = await signDevicePayload(deviceKey, body);

        const res = await app.request(`/devices/${DEVICE_ID}/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SVX-Signature": signature,
            "X-SVX-Timestamp": String(sixMinutesAgo),
          },
          body,
        });

        expect(res.status).toBe(401);
        const json = (await res.json()) as { error: string };
        expect(json.error).toMatch(/replay|timestamp/i);
      },
      15000,
    );

    it(
      "rejects request if timestamp is more than 5 minutes in the future",
      async () => {
        const { app, deviceKey } = await setup();
        const sixMinutesFuture = Date.now() + 6 * 60 * 1000;
        const body = JSON.stringify({ deviceId: DEVICE_ID, t: sixMinutesFuture });
        const signature = await signDevicePayload(deviceKey, body);

        const res = await app.request(`/devices/${DEVICE_ID}/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SVX-Signature": signature,
            "X-SVX-Timestamp": String(sixMinutesFuture),
          },
          body,
        });

        expect(res.status).toBe(401);
      },
      15000,
    );

    it(
      "rejects tampered signature with 401",
      async () => {
        const { app, deviceKey } = await setup();
        const now = Date.now();
        const body = JSON.stringify({ deviceId: DEVICE_ID, t: now });
        const signature = await signDevicePayload(deviceKey, body);

        const res = await app.request(`/devices/${DEVICE_ID}/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SVX-Signature": signature.replace("a", "b"),
            "X-SVX-Timestamp": String(now),
          },
          body,
        });

        expect(res.status).toBe(401);
      },
      15000,
    );

    it(
      "returns 404 for unknown device",
      async () => {
        const { app, deviceKey } = await setup();
        const now = Date.now();
        const body = JSON.stringify({ deviceId: "UNKNOWN-DEVICE", t: now });
        const signature = await signDevicePayload(deviceKey, body);

        const res = await app.request(`/devices/UNKNOWN-DEVICE/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SVX-Signature": signature,
            "X-SVX-Timestamp": String(now),
          },
          body,
        });

        expect(res.status).toBe(404);
      },
      15000,
    );
  });

  describe("POST /devices/:deviceId/events", () => {
    it(
      "handles non-crash events with ok: true",
      async () => {
        const { app, deviceKey } = await setup();
        const now = Date.now();
        const event = {
          deviceId: DEVICE_ID,
          t: now,
          type: "state_change",
          data: { from: "IDLE", to: "ARMED" },
          emulated: false,
        };

        const body = JSON.stringify(event);
        const signature = await signDevicePayload(deviceKey, body);

        const res = await app.request(`/devices/${DEVICE_ID}/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SVX-Signature": signature,
            "X-SVX-Timestamp": String(now),
          },
          body,
        });

        expect(res.status).toBe(200);
        const json = (await res.json()) as { ok: boolean };
        expect(json.ok).toBe(true);
      },
      15000,
    );

    it(
      "ingests crash event (impact_detected) into an incident with emulated and trace flags",
      async () => {
        const { app, db, deviceKey, vehicle } = await setup();
        const now = Date.now();
        const crashEvent = {
          deviceId: DEVICE_ID,
          t: now,
          type: "impact_detected",
          data: {
            gForce: 8.2,
            rollover: true,
            fire: false,
            lat: 36.7525,
            lng: 3.0421,
            accuracyM: 10,
          },
          traceInjected: true,
          emulated: true,
        };

        const body = JSON.stringify(crashEvent);
        const signature = await signDevicePayload(deviceKey, body);

        const res = await app.request(`/devices/${DEVICE_ID}/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SVX-Signature": signature,
            "X-SVX-Timestamp": String(now),
          },
          body,
        });

        expect(res.status).toBe(200);
        const json = (await res.json()) as { ok: boolean; ack: string; incidentId: string };
        expect(json.ok).toBe(true);
        expect(json.ack).toMatch(/^SVXACK#[0-9A-F]{8}$/);
        expect(json.incidentId).toBeDefined();

        const incident = await getIncident(db, json.incidentId);
        expect(incident).toBeDefined();
        expect(incident?.recSeverity).toBe("red"); // gForce >= 8 is RED

        expect(incident?.alerts).toHaveLength(1);
        const alert = incident!.alerts[0]!;
        expect(alert).toMatchObject({
          source: "iot",
          channel: "internet",
          authenticated: true,
          emulated: true,
          traceInjected: true,
          vehicleId: vehicle.id,
          gForce: 8.2,
          rollover: true,
        });
      },
      15000,
    );
  });
});
