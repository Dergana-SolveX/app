import { deriveDeviceKey, verifyDevicePayload } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { createDeviceClient } from "./device-client";

describe("DeviceClient (unit tests)", () => {
  const MASTER_SECRET = "svx-device-master-secret-for-testing-32!";
  const DEVICE_ID = "SVX-CHIP-001";

  it("signs heartbeat request with X-SVX-Signature and X-SVX-Timestamp", async () => {
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody = "";

    const deviceKey = await deriveDeviceKey(MASTER_SECRET, DEVICE_ID);

    const client = createDeviceClient({
      deviceId: DEVICE_ID,
      masterDeviceSecret: MASTER_SECRET,
      baseUrl: "http://api.svx.local",
      fetch: async (url, init) => {
        capturedUrl = url.toString();
        capturedHeaders = init?.headers;
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const res = await client.sendHeartbeat({
      state: "IDLE",
      batteryPct: 80,
    });

    expect(res.ok).toBe(true);
    expect(capturedUrl).toBe("http://api.svx.local/devices/SVX-CHIP-001/heartbeat");

    const headers = capturedHeaders as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-SVX-Signature"]).toBeDefined();
    expect(headers["X-SVX-Timestamp"]).toBeDefined();

    // Verify signature was created with device key over the exact body
    const valid = await verifyDevicePayload(deviceKey, capturedBody, headers["X-SVX-Signature"]);
    expect(valid).toBe(true);

    const parsedBody = JSON.parse(capturedBody);
    expect(parsedBody.deviceId).toBe(DEVICE_ID);
    expect(parsedBody.state).toBe("IDLE");
  });

  it("signs crash event with impact_detected type", async () => {
    let capturedBody = "";
    const client = createDeviceClient({
      deviceId: DEVICE_ID,
      masterDeviceSecret: MASTER_SECRET,
      fetch: async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ ok: true, ack: "SVXACK#12345678" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const res = await client.sendCrashEvent({
      data: { gForce: 8.5 },
      emulated: true,
    });

    expect(res.ok).toBe(true);
    expect(res.ack).toBe("SVXACK#12345678");

    const parsed = JSON.parse(capturedBody);
    expect(parsed.type).toBe("impact_detected");
    expect(parsed.data.gForce).toBe(8.5);
    expect(parsed.emulated).toBe(true);
  });
});
