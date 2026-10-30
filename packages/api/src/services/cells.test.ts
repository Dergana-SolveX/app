import { cellTowers } from "@solvex-dergana/db/schema/index";
import { createTestDb } from "@solvex-dergana/db/testing";
import { describe, expect, it } from "vitest";

import { findNearestTower, listSurveyTowers, recordCellSurvey, resolveCell } from "./cells";

// Made-up tower ids (test data) at real places.
const towers = [
  { mcc: 603, mnc: 1, lac: 100, cid: 1, lat: 36.7255, lng: 3.1836, rangeM: 1_200, source: "opencellid" as const }, // Bab Ezzouar
  { mcc: 603, mnc: 1, lac: 100, cid: 2, lat: 36.7197, lng: 3.1347, rangeM: 900, source: "opencellid" as const }, // El Harrach
  { mcc: 603, mnc: 2, lac: 7, cid: 1, lat: 36.7733, lng: 3.0588, rangeM: 2_500, source: "survey" as const }, // Alger-Centre
];

async function setup() {
  const db = await createTestDb();
  await db.insert(cellTowers).values(towers);
  return db;
}

describe("resolveCell", () => {
  it("turns a cell id into where the tower is and how far it reaches", async () => {
    const db = await setup();

    expect(await resolveCell(db, { mcc: 603, mnc: 1, lac: 100, cid: 2 })).toEqual({ lat: 36.7197, lng: 3.1347, rangeM: 900 });
  });

  it("tells the same cid apart on another network or area, and returns null for an unknown cell", async () => {
    const db = await setup();

    expect(await resolveCell(db, { mcc: 603, mnc: 2, lac: 7, cid: 1 })).toMatchObject({ rangeM: 2_500 });
    expect(await resolveCell(db, { mcc: 603, mnc: 1, lac: 7, cid: 1 })).toBeNull();
  });
});

describe("findNearestTower", () => {
  it("finds the nearest tower to a point, and says how far it is", async () => {
    const db = await setup();

    // Dar El Beida (36.7145, 3.2125): Bab Ezzouar's tower is about 3 km away, the others much farther.
    const found = await findNearestTower(db, 36.7145, 3.2125);

    expect(found).toMatchObject({ mcc: 603, mnc: 1, lac: 100, cid: 1, rangeM: 1_200 });
    expect(found!.distanceM).toBeGreaterThan(2_000);
    expect(found!.distanceM).toBeLessThan(4_000);
  });

  it("returns null when no tower is within reach", async () => {
    const db = await setup();
    expect(await findNearestTower(db, 36.7381, 3.28, 2_000)).toBeNull(); // Rouiba: nearest tower is about 9 km away
  });
});

describe("recordCellSurvey and listSurveyTowers (FR-S4-08)", () => {
  it("inserts a new survey pair with source='survey'", async () => {
    const db = await setup();

    const result = await recordCellSurvey(db, {
      mcc: 603,
      mnc: 1,
      lac: 500,
      cid: 1234,
      lat: 36.75,
      lng: 3.05,
      rangeM: 650,
      signalDbm: -72,
    });

    expect(result.ok).toBe(true);
    expect(result.tower.source).toBe("survey");

    // Can be resolved directly
    const resolved = await resolveCell(db, { mcc: 603, mnc: 1, lac: 500, cid: 1234 });
    expect(resolved).toEqual({ lat: 36.75, lng: 3.05, rangeM: 650 });
  });

  it("upserts existing cell tower with updated coordinates from survey", async () => {
    const db = await setup();

    // Tower was originally at 36.7197, 3.1347 with rangeM 900 and source 'opencellid'
    await recordCellSurvey(db, {
      mcc: 603,
      mnc: 1,
      lac: 100,
      cid: 2,
      lat: 36.7201,
      lng: 3.1352,
      rangeM: 700,
    });

    const updated = await resolveCell(db, { mcc: 603, mnc: 1, lac: 100, cid: 2 });
    expect(updated).toEqual({ lat: 36.7201, lng: 3.1352, rangeM: 700 });
  });

  it("lists surveyed towers filtered by source='survey'", async () => {
    const db = await setup();

    // Already 1 survey tower in test fixtures (mcc: 603, mnc: 2, lac: 7, cid: 1)
    await recordCellSurvey(db, {
      mcc: 603,
      mnc: 3,
      lac: 44,
      cid: 99,
      lat: 36.7,
      lng: 3.1,
    });

    const surveyed = await listSurveyTowers(db);
    expect(surveyed.length).toBe(2);
    expect(surveyed.every((t) => t.source === "survey")).toBe(true);
  });
});
