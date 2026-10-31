import { describe, expect, it } from "vitest";

import { decodeSvx } from "./protocol";
import { buildWitnessSvxAlert, buildWitnessSvxString } from "./builder";

describe("Witness SVX SMS Builder (FR-S4-04, FR-S4-06)", () => {
  it("builds a valid SVX1 string with layer 2, coordinates encoded as geohash, and CRC8", () => {
    const report = {
      victims: 2,
      conscious: 1 as const,
      fire: false,
      trapped: true,
      bleeding: false,
      lat: 36.7525,
      lng: 3.042,
      timestamp: 1793361600000, // known timestamp
    };

    const alertObj = buildWitnessSvxAlert(report);
    expect(alertObj.layer).toBe(2);
    expect(alertObj.victims).toBe(2);

    const result = buildWitnessSvxString(report);

    expect(result.svx).toMatch(/^SVX1#L:2#GH:[0-9b-hjkmnp-z]{8}#T:[0-9a-z]+.*#CK:[0-9A-F]{2}$/);
    expect(result.charCount).toBe(result.svx.length);
    expect(result.charCount).toBeLessThanOrEqual(160);
    expect(result.isSingleSegment).toBe(true);

    // Decode and verify roundtrip
    const decoded = decodeSvx(result.svx);
    expect(decoded.recognized).toBe(true);
    expect(decoded.crcValid).toBe(true);
    expect(decoded.alert.layer).toBe(2);
    expect(decoded.alert.victims).toBe(2);
    expect(decoded.alert.conscious).toBe(1);
    expect(decoded.alert.trapped).toBe(true);
    expect(decoded.alert.fire).toBe(false);
    expect(decoded.alert.bleeding).toBe(false);
    expect(decoded.alert.geohash).not.toBeNull();
  });

  it("handles report without GPS coordinates (geohash empty)", () => {
    const report = {
      victims: 1,
      conscious: 0 as const,
      fire: true,
      trapped: false,
      bleeding: true,
      lat: null,
      lng: null,
      timestamp: 1793361600000,
    };

    const alertObj = buildWitnessSvxAlert(report);
    expect(alertObj.layer).toBe(2);
    expect(alertObj.victims).toBe(1);

    const result = buildWitnessSvxString(report);
    expect(result.svx).toContain("#GH:#");
    expect(result.charCount).toBeLessThanOrEqual(160);

    const decoded = decodeSvx(result.svx);
    expect(decoded.recognized).toBe(true);
    expect(decoded.crcValid).toBe(true);
    expect(decoded.alert.layer).toBe(2);
    expect(decoded.alert.geohash).toBeNull();
    expect(decoded.alert.fire).toBe(true);
    expect(decoded.alert.conscious).toBe(0);
    expect(decoded.alert.bleeding).toBe(true);
  });

  it("reports accurate character count and segment limits for preview", () => {
    const report = {
      victims: 3,
      conscious: 2 as const,
      fire: true,
      trapped: true,
      bleeding: true,
      lat: 36.7,
      lng: 3.1,
      timestamp: Date.now(),
    };

    const alertObj = buildWitnessSvxAlert(report);
    expect(alertObj.layer).toBe(2);
    expect(alertObj.victims).toBe(3);

    const result = buildWitnessSvxString(report);
    expect(result.charCount).toBe(result.svx.length);
    expect(result.remainingChars).toBe(160 - result.charCount);
    expect(result.remainingChars).toBeGreaterThan(0);
  });

  it("encodes serving cell tower ID when provided (FR-S4-05)", () => {
    const report = {
      victims: 1,
      conscious: 1 as const,
      fire: false,
      trapped: false,
      bleeding: false,
      lat: 36.75,
      lng: 3.05,
      cell: { mcc: 603, mnc: 1, lac: 101, cid: 404 },
    };

    const alert = buildWitnessSvxAlert(report);
    expect(alert.cell).toEqual({ mcc: 603, mnc: 1, lac: 101, cid: 404 });

    const result = buildWitnessSvxString(report);
    expect(result.svx).toContain("#CI:");

    const decoded = decodeSvx(result.svx);
    expect(decoded.alert.cell).toEqual({ mcc: 603, mnc: 1, lac: 101, cid: 404 });
  });
});
