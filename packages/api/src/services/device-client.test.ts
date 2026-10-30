import { createEventBus } from "@solvex-dergana/api/services/events";
import { getIncident } from "@solvex-dergana/api/services/incidents";
import { createTestDb } from "@solvex-dergana/db/testing";
import { vehicles } from "@solvex-dergana/db/schema/index";
import { deriveDeviceKey, deviceKeyCheck } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { createDeviceClient } from "./device-client";
import { createDeviceApp } from "../../../../apps/server/src/device-routes";

describe("DeviceClient (scripted test client)", () => {
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

    const serverApp = createDeviceApp({
      masterDeviceSecret: MASTER_SECRET,
      db,
      events,
    });

    const client = createDeviceClient({
      deviceId: DEVICE_ID,
      masterDeviceSecret: MASTER_SECRET,
      baseUrl: "http://localhost:3000",
      fetch: (url, init) => serverApp.request(url, init),
    });

    return { db, events, vehicle: vehicle!, client };
  }

  it(
    "proves end-to-end path: sends signed heartbeat and signed crash event",
    async () => {
      const { client, db, vehicle } = await setup();

      // 1. Send signed heartbeat
      const heartbeatRes = await client.sendHeartbeat({
        state: "IDLE",
        batteryPct: 92,
        batteryMv: 4120,
        gps: { fix: true, sats: 10, lat: 36.75, lng: 3.05 },
      });
      expect(heartbeatRes.ok).toBe(true);

      const [updatedVehicle] = await db.select().from(vehicles);
      expect(updatedVehicle?.batteryMv).toBe(4120);
      expect(updatedVehicle?.lastHeartbeatAt).toBeInstanceOf(Date);
      expect(updatedVehicle?.lastTelemetry).toMatchObject({ state: "IDLE" });

      // 2. Send signed crash event
      const crashRes = await client.sendCrashEvent({
        data: {
          gForce: 8.5,
          rollover: true,
          fire: false,
          lat: 36.753,
          lng: 3.054,
        },
        emulated: true,
        traceInjected: true,
      });

      expect(crashRes.ok).toBe(true);
      expect(crashRes.ack).toMatch(/^SVXACK#[0-9A-F]{8}$/);
      expect(crashRes.incidentId).toBeDefined();

      const incident = await getIncident(db, crashRes.incidentId!);
      expect(incident?.recSeverity).toBe("red");
      expect(incident?.alerts[0]).toMatchObject({
        source: "iot",
        channel: "internet",
        authenticated: true,
        emulated: true,
        traceInjected: true,
        vehicleId: vehicle.id,
      });
    },
    15000,
  );
});
