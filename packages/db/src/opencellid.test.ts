import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { importOpenCellId } from "./opencellid";
import { cellTowers } from "./schema";
import { createTestDb } from "./testing";

// OpenCelliD's CSV format. The rows are made-up TEST DATA (ids invented, coordinates at real places).
const HEADER = "radio,mcc,net,area,cell,unit,lon,lat,range,samples,changeable,created,updated,averageSignal";
const row = (radio: string, mcc: number, net: number, area: number, cell: number, lon: number, lat: number, range: number) =>
  `${radio},${mcc},${net},${area},${cell},0,${lon},${lat},${range},10,1,1500000000,1700000000,0`;

describe("importOpenCellId", () => {
  it("keeps the towers of Algeria (MCC 603) with their position and range, and drops other countries and broken rows", async () => {
    const db = await createTestDb();

    const result = await importOpenCellId(db, [
      HEADER,
      row("GSM", 603, 1, 100, 1, 3.1836, 36.7255, 1200), // Bab Ezzouar
      row("LTE", 603, 2, 7, 268_000_001, 3.0588, 36.7733, 2500), // a 4G cell id is large
      row("GSM", 208, 1, 100, 1, 2.35, 48.85, 1000), // France: not ours
      row("GSM", 603, 1, 100, 2, 999, 36.7, 1000), // longitude out of range
      "GSM,603,1,abc,3,0,3.1,36.7,1000", // not a number
      "",
    ]);

    expect(result).toEqual({ imported: 2, skipped: 3 });
    const towers = await db.select().from(cellTowers);
    expect(towers.map((t) => [t.mnc, t.lac, t.cid, t.lat, t.lng, t.rangeM, t.source]).sort()).toEqual([
      [1, 100, 1, 36.7255, 3.1836, 1200, "opencellid"],
      [2, 7, 268_000_001, 36.7733, 3.0588, 2500, "opencellid"],
    ]);
  });

  it("can be run again on a newer file: towers are updated, not duplicated", async () => {
    const db = await createTestDb();
    await importOpenCellId(db, [HEADER, row("GSM", 603, 1, 100, 1, 3.1836, 36.7255, 1200)]);

    await importOpenCellId(db, [HEADER, row("GSM", 603, 1, 100, 1, 3.19, 36.73, 800)]);

    const towers = await db.select().from(cellTowers);
    expect(towers).toHaveLength(1);
    expect(towers[0]).toMatchObject({ lat: 36.73, lng: 3.19, rangeM: 800 });
  });

  it("copes with the same tower listed twice in one file (the last line wins)", async () => {
    const db = await createTestDb();

    const result = await importOpenCellId(db, [
      HEADER,
      row("GSM", 603, 1, 100, 1, 3.1836, 36.7255, 1200),
      row("GSM", 603, 1, 100, 1, 3.19, 36.73, 800),
    ]);

    expect(result.imported).toBe(1);
    expect(await db.select().from(cellTowers)).toMatchObject([{ lat: 36.73, rangeM: 800 }]);
  });

  it("never overwrites a tower we surveyed ourselves", async () => {
    const db = await createTestDb();
    await db.insert(cellTowers).values({ mcc: 603, mnc: 1, lac: 100, cid: 1, lat: 36.7, lng: 3.1, rangeM: 300, source: "survey" });

    await importOpenCellId(db, [HEADER, row("GSM", 603, 1, 100, 1, 3.19, 36.73, 800)]);

    const [tower] = await db.select().from(cellTowers).where(eq(cellTowers.cid, 1));
    expect(tower).toMatchObject({ lat: 36.7, lng: 3.1, rangeM: 300, source: "survey" });
  });
});
