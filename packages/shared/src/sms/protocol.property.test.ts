import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decodeSvx, encodeSvx, type SvxAlert } from "./protocol";

const GEOHASH_CHARS = "0123456789bcdefghjkmnpqrstuvwxyz".split("");
const UID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const maybe = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: null });

const alertArb: fc.Arbitrary<SvxAlert> = fc.record({
  layer: fc.constantFrom(1, 2, 3) as fc.Arbitrary<1 | 2 | 3>,
  geohash: maybe(fc.string({ unit: fc.constantFrom(...GEOHASH_CHARS), minLength: 8, maxLength: 8 })),
  eventMinutes: fc.integer({ min: 0, max: 60_000_000 }),
  peakG: maybe(fc.integer({ min: 0, max: 2000 }).map((n) => n / 10)),
  rollover: maybe(fc.boolean()),
  fire: maybe(fc.boolean()),
  victims: maybe(fc.integer({ min: 0, max: 9 })),
  conscious: maybe(fc.constantFrom(0, 1, 2) as fc.Arbitrary<0 | 1 | 2>),
  trapped: maybe(fc.boolean()),
  bleeding: maybe(fc.boolean()),
  profileCode: maybe(fc.string({ unit: fc.constantFrom(...UID_CHARS), minLength: 8, maxLength: 8 })),
  deltaVKmh: maybe(fc.integer({ min: 0, max: 300 })),
  cell: maybe(
    fc.record({
      mcc: fc.integer({ min: 0, max: 999 }),
      mnc: fc.integer({ min: 0, max: 999 }),
      lac: fc.integer({ min: 0, max: 0xffff }),
      cid: fc.integer({ min: 0, max: 0xfffffff }),
    }),
  ),
});

// The characters an SVX message may contain: all are in the GSM 7-bit default alphabet.
const GSM7_SAFE = /^[A-Za-z0-9#:.\-]*$/;

describe("SVX v1 properties", () => {
  it("round-trips: decode(encode(alert)) gives the alert back, with a valid CRC and no errors", () => {
    fc.assert(
      fc.property(alertArb, (alert) => {
        const decoded = decodeSvx(encodeSvx(alert));
        expect(decoded.recognized).toBe(true);
        expect(decoded.crcValid).toBe(true);
        expect(decoded.parseErrors).toEqual([]);
        expect(decoded.alert).toEqual(alert);
      }),
    );
  });

  it("always fits one SMS segment and uses GSM-7 safe characters only", () => {
    fc.assert(
      fc.property(alertArb, (alert) => {
        const sms = encodeSvx(alert);
        expect(sms.length).toBeLessThanOrEqual(160);
        expect(sms).toMatch(GSM7_SAFE);
      }),
    );
  });

  it("detects any single-character change anywhere in the message", () => {
    fc.assert(
      fc.property(alertArb, fc.nat(), fc.constantFrom(...UID_CHARS, ":", "#", "."), (alert, pos, ch) => {
        const sms = encodeSvx(alert);
        const i = pos % sms.length;
        fc.pre(sms[i] !== ch);
        const changed = sms.slice(0, i) + ch + sms.slice(i + 1);
        expect(decodeSvx(changed).crcValid).toBe(false);
      }),
    );
  });

  it("detects every truncation (a cut-off message is never reported as valid)", () => {
    fc.assert(
      fc.property(alertArb, fc.nat(), (alert, cut) => {
        const sms = encodeSvx(alert);
        const prefix = sms.slice(0, cut % sms.length);
        expect(decodeSvx(prefix).crcValid).toBe(false);
      }),
    );
  });

  it("never throws on arbitrary text and always returns a result", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (text) => {
        const decoded = decodeSvx(text);
        expect(Array.isArray(decoded.parseErrors)).toBe(true);
        expect(decoded.alert).toBeDefined();
      }),
    );
  });

  it("never throws when keys are JavaScript object internals (__proto__, constructor, toString...)", () => {
    const internalKeys = Object.getOwnPropertyNames(Object.prototype);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...internalKeys), fc.string({ maxLength: 8 })), { maxLength: 8 }),
        (pairs) => {
          const decoded = decodeSvx(["SVX1", ...pairs.map(([k, v]) => `${k}:${v}`)].join("#"));
          expect(decoded.recognized).toBe(true);
        },
      ),
    );
  });

  it("never throws on SVX-looking text with random fields", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 20 }), { maxLength: 12 }), (tokens) => {
        const decoded = decodeSvx(["SVX1", ...tokens].join("#"));
        expect(decoded.recognized).toBe(true);
      }),
    );
  });
});
