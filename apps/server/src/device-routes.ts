import type { EventBus } from "@solvex-dergana/api/services/events";
import {
  findVehicleByDeviceId,
  ingestDeviceEvent,
  recordHeartbeat,
  type VehicleRow,
} from "@solvex-dergana/api/services/devices";
import type { Database } from "@solvex-dergana/db";
import { deriveDeviceKey, verifyDevicePayload } from "@solvex-dergana/shared";
import { Hono } from "hono";

export type DeviceAppDeps = {
  masterDeviceSecret: string;
  db: Database;
  events: EventBus;
};

type DeviceVariables = {
  vehicle: VehicleRow;
  bodyJson: Record<string, unknown> | null;
  rawBody: string;
  timestampMs: number;
};

const MAX_DRIFT_MS = 5 * 60 * 1000; // ±5 min replay window (PRD FR-S3-11)

/**
 * REST endpoints for B2B IoT crash chips (/devices/:deviceId/heartbeat and /events).
 * Authenticated with X-SVX-Signature HMAC-SHA256(derivedKey, body) + timestamp check.
 */
export function createDeviceApp({ masterDeviceSecret, db, events }: DeviceAppDeps) {
  const app = new Hono<{ Variables: DeviceVariables }>();

  // Common authentication & replay protection middleware for /devices/:deviceId/*
  app.use("/devices/:deviceId/*", async (c, next) => {
    const deviceId = c.req.param("deviceId");
    if (!deviceId) return c.json({ error: "device_not_found" }, 404);

    const vehicle = await findVehicleByDeviceId(db, deviceId);
    if (!vehicle) {
      return c.json({ error: "device_not_found" }, 404);
    }

    const sigHeader = c.req.header("x-svx-signature");
    if (!sigHeader) {
      return c.json({ error: "unauthorized", message: "missing_signature" }, 401);
    }

    let signature = sigHeader.trim();
    let rawTimestamp: string | number | undefined = c.req.header("x-svx-timestamp");

    // Support Stripe-style t=...,v1=... in X-SVX-Signature
    if (sigHeader.includes("t=") && (sigHeader.includes("sig=") || sigHeader.includes("v1="))) {
      const parts = Object.fromEntries(
        sigHeader.split(",").map((p) => p.trim().split("=").map((s) => s.trim())),
      );
      rawTimestamp = parts["t"];
      signature = parts["v1"] || parts["sig"] || signature;
    }

    const rawBody = await c.req.text();
    let bodyJson: Record<string, unknown> | null = null;
    try {
      bodyJson = JSON.parse(rawBody);
      if (rawTimestamp === undefined && bodyJson && bodyJson["t"] !== undefined) {
        rawTimestamp = bodyJson["t"] as number | string;
      }
    } catch {
      // Body may not be JSON
    }

    if (rawTimestamp === undefined || rawTimestamp === "") {
      return c.json({ error: "unauthorized", message: "missing_timestamp" }, 401);
    }

    const tsNum = typeof rawTimestamp === "number" ? rawTimestamp : Number(rawTimestamp);
    const tsMs = !isNaN(tsNum)
      ? tsNum < 1e11
        ? tsNum * 1000
        : tsNum
      : new Date(rawTimestamp).getTime();

    if (isNaN(tsMs)) {
      return c.json({ error: "unauthorized", message: "invalid_timestamp" }, 401);
    }

    const drift = Math.abs(Date.now() - tsMs);
    if (drift > MAX_DRIFT_MS) {
      return c.json({ error: "replay_rejected", message: "timestamp outside +-5 min window" }, 401);
    }

    const deviceKey = await deriveDeviceKey(masterDeviceSecret, deviceId);
    const valid = await verifyDevicePayload(deviceKey, rawBody, signature);
    if (!valid) {
      return c.json({ error: "unauthorized", message: "invalid_signature" }, 401);
    }

    c.set("vehicle", vehicle);
    c.set("bodyJson", bodyJson);
    c.set("rawBody", rawBody);
    c.set("timestampMs", tsMs);

    await next();
  });

  app.post("/devices/:deviceId/heartbeat", async (c) => {
    const deviceId = c.req.param("deviceId");
    const bodyJson = c.get("bodyJson") ?? {};
    const tsMs = c.get("timestampMs");

    const result = await recordHeartbeat(
      { db },
      {
        deviceId,
        timestamp: new Date(tsMs),
        telemetry: bodyJson,
        batteryMv: typeof bodyJson["batteryMv"] === "number" ? bodyJson["batteryMv"] : null,
        batteryPct: typeof bodyJson["batteryPct"] === "number" ? bodyJson["batteryPct"] : null,
        firmwareVersion:
          typeof bodyJson["firmwareVersion"] === "string" ? bodyJson["firmwareVersion"] : null,
      },
    );

    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    return c.json({ ok: true });
  });

  app.post("/devices/:deviceId/events", async (c) => {
    const deviceId = c.req.param("deviceId");
    const vehicle = c.get("vehicle");
    const bodyJson = c.get("bodyJson");
    const rawBody = c.get("rawBody");
    const tsMs = c.get("timestampMs");

    if (!bodyJson || typeof bodyJson["type"] !== "string") {
      return c.json({ error: "invalid_body" }, 400);
    }

    const result = await ingestDeviceEvent(
      { db, events },
      {
        deviceId,
        vehicle,
        event: bodyJson as any,
        rawPayload: rawBody,
        timestamp: new Date(tsMs),
      },
    );

    return c.json(result);
  });

  return app;
}
