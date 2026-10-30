/**
 * Scripted test client for SVX Rescue IoT crash chips (FR-S3-11, FR-S8-03, Issue #14).
 *
 * Usage:
 *   bun scripts/test-chip-client.ts [deviceId] [serverUrl] [masterSecret]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDeviceClient } from "../packages/api/src/services/device-client";

function getMasterSecret(): string {
  if (process.argv[4]) return process.argv[4];
  if (process.env.MASTER_DEVICE_SECRET) return process.env.MASTER_DEVICE_SECRET;
  try {
    const envPath = resolve(process.cwd(), "apps/server/.env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      const match = content.match(/^MASTER_DEVICE_SECRET=(.+)$/m);
      if (match && match[1]) {
        return match[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {}
  return "svx-device-master-secret-for-testing-32!";
}

const deviceId = process.argv[2] || "SVX-CHIP-001";
const baseUrl = process.argv[3] || process.env.SERVER_URL || "http://localhost:3000";
const masterSecret = getMasterSecret();

console.log(`[SVX Test Chip] Initialising test client for device "${deviceId}" against ${baseUrl}`);

const client = createDeviceClient({
  deviceId,
  masterDeviceSecret: masterSecret,
  baseUrl,
});

async function run() {
  console.log(`[SVX Test Chip] Sending signed heartbeat...`);
  const hbRes = await client.sendHeartbeat({
    state: "ARMED",
    batteryPct: 95,
    batteryMv: 4180,
    vehicle12vOk: true,
    gps: { fix: true, sats: 12, lat: 36.7525, lng: 3.0421 },
  });
  console.log(`[SVX Test Chip] Heartbeat response:`, hbRes);

  console.log(`[SVX Test Chip] Sending signed crash event (impact_detected)...`);
  const crashRes = await client.sendCrashEvent({
    data: {
      gForce: 8.7,
      deltaVKmh: 42,
      rollover: true,
      fire: false,
      lat: 36.7525,
      lng: 3.0421,
      accuracyM: 10,
    },
    emulated: true,
    traceInjected: true,
  });
  console.log(`[SVX Test Chip] Crash event response:`, crashRes);

  if (crashRes.ok && crashRes.ack) {
    console.log(`[SVX Test Chip] Received ACK: ${crashRes.ack} for incident ${crashRes.incidentId}`);
  }
}

run().catch((err) => {
  console.error(`[SVX Test Chip] Error:`, err);
  process.exit(1);
});
