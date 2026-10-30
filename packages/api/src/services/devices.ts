import type { Database } from "@solvex-dergana/db";
import { rawAlerts, vehicles } from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";

import { placeAlert } from "./clustering";
import type { EventBus } from "./events";
import { ackFor } from "./ingest";
import { retriageIncident } from "./triage";

export type VehicleRow = typeof vehicles.$inferSelect;

export async function findVehicleByDeviceId(
  db: Database,
  deviceId: string,
): Promise<VehicleRow | null> {
  const [vehicle] = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.deviceId, deviceId));
  return vehicle ?? null;
}

export type HeartbeatInput = {
  deviceId: string;
  timestamp: Date;
  telemetry: Record<string, unknown>;
  batteryMv?: number | null;
  batteryPct?: number | null;
  firmwareVersion?: string | null;
};

export async function recordHeartbeat(
  { db }: { db: Database },
  input: HeartbeatInput,
) {
  const vehicle = await findVehicleByDeviceId(db, input.deviceId);
  if (!vehicle) return { ok: false, error: "device_not_found" as const };

  const batteryMv =
    input.batteryMv ??
    (input.batteryPct !== null && input.batteryPct !== undefined
      ? Math.round(3300 + (input.batteryPct / 100) * 900)
      : null);

  await db
    .update(vehicles)
    .set({
      lastHeartbeatAt: input.timestamp,
      ...(batteryMv !== null ? { batteryMv } : {}),
      ...(input.firmwareVersion ? { firmwareVersion: input.firmwareVersion } : {}),
      lastTelemetry: input.telemetry,
    })
    .where(eq(vehicles.id, vehicle.id));

  return { ok: true as const };
}

export type DeviceEventInput = {
  deviceId: string;
  vehicle: VehicleRow;
  event: {
    type: string;
    t?: number;
    data?: Record<string, unknown>;
    emulated?: boolean;
    traceInjected?: boolean;
  };
  rawPayload: string;
  timestamp: Date;
};

export async function ingestDeviceEvent(
  { db, events }: { db: Database; events: EventBus },
  input: DeviceEventInput,
) {
  const { deviceId, vehicle, event, rawPayload, timestamp } = input;

  if (event.type === "impact_detected") {
    const data = event.data ?? {};
    const gps = (data["gps"] as Record<string, unknown>) ?? {};

    const lat = (data["lat"] as number) ?? (gps["lat"] as number) ?? null;
    const lng = (data["lng"] as number) ?? (gps["lng"] as number) ?? null;
    const accuracyM = (data["accuracyM"] as number) ?? (gps["accuracyM"] as number) ?? 15;
    const position = lat !== null && lng !== null ? { lat, lng, accuracyM } : null;
    const dedupeKey = `device:${deviceId}:${event.t ?? timestamp.getTime()}`;

    const alertRow = {
      incidentId: null,
      source: "iot" as const,
      channel: "internet" as const,
      receivedAt: new Date(),
      eventAt: timestamp,
      lat,
      lng,
      geohash: (data["geohash"] as string) ?? null,
      accuracyM,
      gForce: (data["gForce"] as number) ?? (data["g"] as number) ?? null,
      deltaVKmh: (data["deltaVKmh"] as number) ?? (data["deltaV"] as number) ?? null,
      rolloverDeg: (data["rolloverDeg"] as number) ?? (data["roll"] as number) ?? null,
      rollover: (data["rollover"] as boolean) ?? null,
      fire: (data["fire"] as boolean) ?? null,
      victims: (data["victims"] as number) ?? null,
      conscious: (data["conscious"] as number) ?? null,
      trapped: (data["trapped"] as boolean) ?? null,
      bleeding: (data["bleeding"] as boolean) ?? null,
      profileId: vehicle.ownerProfileId ?? null,
      vehicleId: vehicle.id,
      rawPayload,
      dedupeKey,
      emulated: event.emulated ?? false,
      traceInjected: event.traceInjected ?? false,
      authenticated: true,
    };

    const placement = await placeAlert(db, { alertRow, position, eventAt: timestamp });

    if (placement.kind === "created" || placement.kind === "merged") {
      const triaged = await retriageIncident(
        { db, events },
        placement.incident.id,
        { announce: false },
      ).catch(() => null);
      const incident = triaged ?? placement.incident;
      events.publish({
        type: placement.kind === "created" ? "incident.created" : "incident.updated",
        incident,
      });
    }

    const incidentId =
      placement.kind !== "duplicate"
        ? placement.incident.id
        : (
            await db
              .select({ incidentId: rawAlerts.incidentId })
              .from(rawAlerts)
              .where(eq(rawAlerts.dedupeKey, dedupeKey))
          )[0]!.incidentId!;

    return {
      ok: true as const,
      incidentId,
      ack: ackFor(incidentId),
    };
  }

  return { ok: true as const };
}
