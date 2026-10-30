import { describe, expect, it } from "vitest";

import {
  deriveDeviceKey,
  deviceKeyCheck,
  signDevicePayload,
  verifyDevicePayload,
} from "./deviceKey";

describe("deviceKey crypto", () => {
  const masterSecret = "svx-master-secret-for-tests-32chars!";
  const deviceId = "SVX-CHIP-001";

  it("derives a consistent 32-byte key from master secret and device ID", async () => {
    const key1 = await deriveDeviceKey(masterSecret, deviceId);
    const key2 = await deriveDeviceKey(masterSecret, deviceId);
    expect(key1.length).toBe(32);
    expect(key1).toEqual(key2);

    const hash = await deviceKeyCheck(key1);
    expect(hash).toHaveLength(64);
  });

  it("signs a body with HMAC-SHA256 and verifies it", async () => {
    const key = await deriveDeviceKey(masterSecret, deviceId);
    const body = JSON.stringify({ deviceId, t: 1730300000000, state: "IDLE" });

    const sig = await signDevicePayload(key, body);
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);

    const valid = await verifyDevicePayload(key, body, sig);
    expect(valid).toBe(true);
  });

  it("accepts uppercase hex signatures", async () => {
    const key = await deriveDeviceKey(masterSecret, deviceId);
    const body = "hello";
    const sig = await signDevicePayload(key, body);

    expect(await verifyDevicePayload(key, body, sig.toUpperCase())).toBe(true);
  });

  it("rejects tampered body or signature", async () => {
    const key = await deriveDeviceKey(masterSecret, deviceId);
    const otherKey = await deriveDeviceKey(masterSecret, "SVX-CHIP-002");
    const body = JSON.stringify({ deviceId, t: 1730300000000, state: "IDLE" });
    const sig = await signDevicePayload(key, body);

    expect(await verifyDevicePayload(key, body + " ", sig)).toBe(false);
    expect(await verifyDevicePayload(otherKey, body, sig)).toBe(false);
    expect(await verifyDevicePayload(key, body, sig.slice(0, -1) + "0")).toBe(false);
    expect(await verifyDevicePayload(key, body, "not-a-hex-signature")).toBe(false);
    expect(await verifyDevicePayload(key, body, "")).toBe(false);
  });
});
