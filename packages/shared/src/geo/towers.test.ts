import { describe, expect, it } from "vitest";

import { nearestTower, type Tower } from "./towers";

// Made-up tower ids at real places (the ids are test data; the coordinates are real landmarks).
const tower = (cid: number, lat: number, lng: number, rangeM = 1_500): Tower => ({ mcc: 603, mnc: 1, lac: 100, cid, lat, lng, rangeM });
const BAB_EZZOUAR = tower(1, 36.7255, 3.1836);
const EL_HARRACH = tower(2, 36.7197, 3.1347);
const ALGER_CENTRE = tower(3, 36.7733, 3.0588);

describe("nearestTower", () => {
  it("finds the tower closest to a point, with its distance", () => {
    // Dar El Beida (36.7145, 3.2125) is about 3 km from Bab Ezzouar, 9 km from El Harrach.
    const found = nearestTower([ALGER_CENTRE, EL_HARRACH, BAB_EZZOUAR], 36.7145, 3.2125);

    expect(found?.tower.cid).toBe(1);
    expect(found!.distanceM).toBeGreaterThan(2_000);
    expect(found!.distanceM).toBeLessThan(4_000);
  });

  it("ignores towers farther than the limit, and returns null when none is in reach", () => {
    // Rouiba (36.7381, 3.28) is about 9 km from the nearest of these.
    expect(nearestTower([ALGER_CENTRE, EL_HARRACH, BAB_EZZOUAR], 36.7381, 3.28, 5_000)).toBeNull();
    expect(nearestTower([], 36.7381, 3.28)).toBeNull();
  });
});
