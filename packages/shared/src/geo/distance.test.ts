import { describe, expect, it } from "vitest";

import { boundingBox, haversineM } from "./distance";

// Expected values were computed independently (Python, mean Earth radius 6371008.8 m).
describe("haversineM", () => {
  it("measures real distances in Algiers within a metre", () => {
    // Alger-Centre -> Bab Ezzouar
    expect(haversineM(36.7538, 3.0588, 36.725, 3.183)).toBeCloseTo(11521.202, 0);
    // Algiers -> Oran: about 351 km
    expect(haversineM(36.7538, 3.0588, 35.6971, -0.6308)).toBeCloseTo(351168.829, 0);
  });

  it("knows one degree of longitude on the equator is about 111.2 km", () => {
    expect(haversineM(0, 0, 0, 1)).toBeCloseTo(111195.08, 1);
  });

  it("is zero for the same point and the same both ways", () => {
    expect(haversineM(36.75, 3.06, 36.75, 3.06)).toBe(0);
    expect(haversineM(36.7538, 3.0588, 36.725, 3.183)).toBeCloseTo(haversineM(36.725, 3.183, 36.7538, 3.0588), 6);
  });
});

describe("boundingBox", () => {
  it("is the box around a point that contains every point within the radius", () => {
    const box = boundingBox(36.75, 3.06, 1000);
    expect(box.minLat).toBeCloseTo(36.75 - 0.00899320363724538, 9);
    expect(box.maxLat).toBeCloseTo(36.75 + 0.00899320363724538, 9);
    expect(box.minLng).toBeCloseTo(3.06 - 0.011223913689772219, 9);
    expect(box.maxLng).toBeCloseTo(3.06 + 0.011223913689772219, 9);
  });

  it("covers a point 150 m away and leaves out one 2 km away", () => {
    const box = boundingBox(36.75, 3.06, 200);
    const inside = { lat: 36.75, lng: 3.06 + 150 / 89_000 }; // about 150 m east
    const outside = { lat: 36.75 + 2000 / 111_195, lng: 3.06 }; // about 2 km north
    const within = (p: { lat: number; lng: number }) =>
      p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng;
    expect(within(inside)).toBe(true);
    expect(within(outside)).toBe(false);
  });
});
