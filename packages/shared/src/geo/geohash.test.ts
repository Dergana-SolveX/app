import { describe, expect, it } from "vitest";

import { geohashDecode, geohashEncode, geohashNeighbors } from "./geohash";

// Expected values were computed independently (Python); the Jutland example is the published
// reference of the geohash algorithm (57.64911, 10.40744 -> u4pruydqqvj).
describe("geohashEncode", () => {
  it("matches the published reference example", () => {
    expect(geohashEncode(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
  });

  it("uses precision 8 by default (about 19 m), as the SVX protocol does", () => {
    expect(geohashEncode(36.725, 3.183)).toBe("snd2bmtf"); // Bab Ezzouar
    expect(geohashEncode(36.7538, 3.0588)).toBe("snd1jdg6"); // Alger-Centre
  });
});

describe("geohashDecode", () => {
  it("returns the centre of the cell and its half-size", () => {
    const cell = geohashDecode("snd2bmtf");
    expect(cell.lat).toBeCloseTo(36.72497749328613, 9);
    expect(cell.lng).toBeCloseTo(3.183116912841797, 9);
    expect(cell.latError).toBeCloseTo(8.58306884765625e-5, 12);
    expect(cell.lngError).toBeCloseTo(0.000171661376953125, 12);
  });

  it("gives a cell that contains the point it was encoded from", () => {
    const cell = geohashDecode(geohashEncode(36.7538, 3.0588));
    expect(Math.abs(cell.lat - 36.7538)).toBeLessThanOrEqual(cell.latError);
    expect(Math.abs(cell.lng - 3.0588)).toBeLessThanOrEqual(cell.lngError);
  });

  it("rejects characters that are not in the geohash alphabet", () => {
    expect(() => geohashDecode("snd2bmta")).toThrow(RangeError); // 'a' is not used
    expect(() => geohashDecode("")).toThrow(RangeError);
  });
});

describe("geohashNeighbors", () => {
  it("returns the 8 surrounding cells", () => {
    expect(geohashNeighbors("snd2bmtf")).toEqual({
      n: "snd2bmtg",
      ne: "snd2bmw5",
      e: "snd2bmw4",
      se: "snd2bmw1",
      s: "snd2bmtc",
      sw: "snd2bmt9",
      w: "snd2bmtd",
      nw: "snd2bmte",
    });
    expect(geohashNeighbors("u4pruydq")).toEqual({
      n: "u4pruydr",
      ne: "u4pruydx",
      e: "u4pruydw",
      se: "u4pruydt",
      s: "u4pruydm",
      sw: "u4pruydj",
      w: "u4pruydn",
      nw: "u4pruydp",
    });
  });
});
