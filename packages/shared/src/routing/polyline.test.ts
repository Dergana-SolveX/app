import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decodePolyline, encodePolyline } from "./polyline";

// The worked example from Google's published "Encoded Polyline Algorithm Format" documentation.
const GOOGLE_POINTS: [number, number][] = [
  [38.5, -120.2],
  [40.7, -120.95],
  [43.252, -126.453],
];
const GOOGLE_ENCODED = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

describe("encodePolyline / decodePolyline (precision 5)", () => {
  it("encodes the published example exactly", () => {
    expect(encodePolyline(GOOGLE_POINTS)).toBe(GOOGLE_ENCODED);
  });

  it("decodes the published example back to its points", () => {
    expect(decodePolyline(GOOGLE_ENCODED)).toEqual(GOOGLE_POINTS);
  });

  it("handles no points", () => {
    expect(encodePolyline([])).toBe("");
    expect(decodePolyline("")).toEqual([]);
  });

  it("round-trips any points with 5 decimals, including negative and small steps", () => {
    const coordinate = (range: number) =>
      fc.integer({ min: -range * 1e5, max: range * 1e5 }).map((n) => n / 1e5);
    fc.assert(
      fc.property(fc.array(fc.tuple(coordinate(90), coordinate(180)), { maxLength: 30 }), (points) => {
        expect(decodePolyline(encodePolyline(points))).toEqual(points);
      }),
    );
  });
});
