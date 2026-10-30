import { describe, expect, it } from "vitest";

import vectors from "../../test-vectors/svx.json";
import { decodeSvx, encodeSvx, verifySvx, type EncodeOptions, type SvxAlert } from "./protocol";

describe("encodeSvx: reference vectors (test-vectors/svx.json)", () => {
  for (const v of vectors.valid) {
    it(`encodes: ${v.name}`, () => {
      expect(encodeSvx(v.alert as SvxAlert)).toBe(v.sms);
    });
  }
});

describe("decodeSvx: reference vectors", () => {
  for (const v of vectors.valid) {
    it(`decodes: ${v.name}`, () => {
      const decoded = decodeSvx(v.sms);
      expect(decoded.recognized).toBe(true);
      expect(decoded.crcValid).toBe(true);
      expect(decoded.parseErrors).toEqual([]);
      expect(decoded.alert).toEqual(v.alert);
    });
  }
});

describe("decodeSvx: corrupted and unusual messages are still ingested", () => {
  for (const c of vectors.corrupted) {
    it(`handles: ${c.name}`, () => {
      const decoded = decodeSvx(c.sms);
      expect(decoded.recognized).toBe(c.expect.recognized);
      expect(decoded.crcValid).toBe(c.expect.crcValid);
      expect(decoded.parseErrors).toEqual(c.expect.parseErrors);
      expect(decoded.alert).toMatchObject(c.expect.alert);
    });
  }
});

describe("encodeSvx: length limit (160 characters by default)", () => {
  for (const c of vectors.lengthLimits) {
    it(c.name, () => {
      const alert = vectors.valid[c.alertIndex]!.alert as SvxAlert;
      if (c.sms === null) {
        expect(() => encodeSvx(alert, { maxLength: c.maxLength })).toThrow(RangeError);
      } else {
        const sms = encodeSvx(alert, { maxLength: c.maxLength });
        expect(sms).toBe(c.sms);
        expect(sms.length).toBeLessThanOrEqual(c.maxLength);
      }
    });
  }
});

const deviceKey = Uint8Array.from(
  vectors.deviceKeyHex.match(/../g)!.map((h) => parseInt(h, 16)),
);

describe("encodeSvx: chip signature (H = first 6 base32 chars of HMAC-SHA256)", () => {
  for (const c of vectors.signed) {
    it(c.name, async () => {
      const alert = vectors.valid[c.alertIndex]!.alert as SvxAlert;
      const sms = await encodeSvx(alert, { deviceKey, maxLength: c.maxLength });
      expect(sms).toBe(c.sms);
      expect(decodeSvx(sms).crcValid).toBe(true);
    });
  }
});

describe("verifySvx", () => {
  for (const c of vectors.verify) {
    it(c.name, async () => {
      expect(await verifySvx(c.sms, deviceKey)).toBe(c.valid);
    });
  }
});

describe("encodeSvx: input handling", () => {
  const base = vectors.valid[0]!.alert as SvxAlert;

  it("writes 9 for nine or more victims (9 means 9+)", () => {
    const sms = encodeSvx({ ...base, victims: 12 });
    expect(sms).toContain("#V:9#");
    expect(decodeSvx(sms).alert.victims).toBe(9);
  });

  it("rounds peak g to one decimal", () => {
    expect(encodeSvx({ ...base, peakG: 8.46 })).toContain("#G:8.5#");
  });

  it("refuses a profile code with characters outside GSM-7 safe uppercase/digits", () => {
    expect(() => encodeSvx({ ...base, profileCode: "É1234567" })).toThrow(TypeError);
    expect(() => encodeSvx({ ...base, profileCode: "SHORT" })).toThrow(TypeError);
  });

  it("refuses a geohash that is not 8 geohash characters", () => {
    expect(() => encodeSvx({ ...base, geohash: "SN2J" })).toThrow(TypeError);
    expect(() => encodeSvx({ ...base, geohash: "sn2j5x7a" })).toThrow(TypeError); // 'a' is not a geohash character
  });

  it("refuses a negative or fractional event time", () => {
    expect(() => encodeSvx({ ...base, eventMinutes: -1 })).toThrow(RangeError);
    expect(() => encodeSvx({ ...base, eventMinutes: 1.5 })).toThrow(RangeError);
  });
});

describe("review fixes: a hostile or garbled distress SMS never crashes ingestion", () => {
  it("ignores keys that collide with JavaScript object internals", () => {
    const decoded = decodeSvx("SVX1#L:2#__proto__:x#constructor:1#toString:2#hasOwnProperty:3");
    expect(decoded.recognized).toBe(true);
    expect(decoded.alert.layer).toBe(2);
    expect(decoded.parseErrors).toEqual(["missing_crc"]);
  });

  it("rejects an event time too large to be a safe integer", () => {
    const decoded = decodeSvx("SVX1#L:1#T:zzzzzzzzzzzzzzzzzzzz");
    expect(decoded.alert.eventMinutes).toBeNull();
    expect(decoded.parseErrors).toContain("invalid_T");
  });

  it("verifySvx answers false (never throws) for an empty key or a malformed message", async () => {
    const empty = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
    expect(await verifySvx(vectors.verify[0]!.sms, empty)).toBe(false);
    expect(await verifySvx("SVX1#H:", deviceKey)).toBe(false);
    expect(await verifySvx("", deviceKey)).toBe(false);
  });

  it("refuses numbers that are not finite instead of writing NaN or Infinity", () => {
    const base = vectors.valid[0]!.alert as SvxAlert;
    expect(() => encodeSvx({ ...base, peakG: NaN })).toThrow(RangeError);
    expect(() => encodeSvx({ ...base, peakG: Infinity })).toThrow(RangeError);
    expect(() => encodeSvx({ ...base, victims: NaN })).toThrow(RangeError);
    expect(() => encodeSvx({ ...base, deltaVKmh: NaN })).toThrow(RangeError);
  });

  it("treats a deviceKey of undefined as 'no key' (unsigned, synchronous)", () => {
    const base = vectors.valid[0]!.alert as SvxAlert;
    const options = { deviceKey: undefined } as unknown as EncodeOptions;
    expect(encodeSvx(base, options)).toBe(vectors.valid[0]!.sms);
  });
});
