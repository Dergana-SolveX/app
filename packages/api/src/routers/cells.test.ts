import { cellTowers } from "@solvex-dergana/db/schema/index";
import { createTestDb } from "@solvex-dergana/db/testing";
import { describe, expect, it } from "vitest";

import { cellsRouter } from "./cells";

async function setup() {
  const db = await createTestDb();
  // Caller context without authentication needed for field survey collection
  const caller = cellsRouter.createCaller({ db } as any);
  return { db, caller };
}

describe("cellsRouter (FR-S4-08)", () => {
  it("logs a survey via tRPC and persists with source='survey'", async () => {
    const { db, caller } = await setup();

    const response = await caller.logSurvey({
      mcc: 603,
      mnc: 1,
      lac: 102,
      cid: 5541,
      lat: 36.7538,
      lng: 3.0588,
      rangeM: 750,
      signalDbm: -68,
    });

    expect(response.ok).toBe(true);
    expect(response.tower.mcc).toBe(603);
    expect(response.tower.mnc).toBe(1);
    expect(response.tower.source).toBe("survey");

    // Can be queried via listSurveys
    const list = await caller.listSurveys();
    expect(list.length).toBe(1);
    expect(list[0]!.cid).toBe(5541);
    expect(list[0]!.operator.name).toBe("Mobilis");
  });

  it("resolves a known cell ID", async () => {
    const { db, caller } = await setup();

    await caller.logSurvey({
      mcc: 603,
      mnc: 2,
      lac: 300,
      cid: 800,
      lat: 36.70,
      lng: 3.10,
    });

    const found = await caller.resolve({ mcc: 603, mnc: 2, lac: 300, cid: 800 });
    expect(found).not.toBeNull();
    expect(found!.lat).toBeCloseTo(36.70, 2);
    expect(found!.lng).toBeCloseTo(3.10, 2);

    const missing = await caller.resolve({ mcc: 603, mnc: 2, lac: 999, cid: 999 });
    expect(missing).toBeNull();
  });
});
