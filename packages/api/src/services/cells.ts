import type { Database } from "@solvex-dergana/db";
import { cellTowers } from "@solvex-dergana/db/schema/index";
import { boundingBox, nearestTower } from "@solvex-dergana/shared";
import { and, eq, gte, lte } from "drizzle-orm";

export type CellId = { mcc: number; mnc: number; lac: number; cid: number };

/**
 * Where a cell is: the one lookup the chip, the app and USSD share (PRD FR-S3-16).
 * `rangeM` is how far the tower reaches, so how unsure the position is. Null for a cell we do not know.
 */
export async function resolveCell(db: Database, { mcc, mnc, lac, cid }: CellId) {
  const [tower] = await db
    .select({ lat: cellTowers.lat, lng: cellTowers.lng, rangeM: cellTowers.rangeM })
    .from(cellTowers)
    .where(and(eq(cellTowers.mcc, mcc), eq(cellTowers.mnc, mnc), eq(cellTowers.lac, lac), eq(cellTowers.cid, cid)));
  return tower ?? null;
}

/** The known tower nearest to a point within `maxM` metres, or null. */
export async function findNearestTower(db: Database, lat: number, lng: number, maxM = 5_000) {
  const box = boundingBox(lat, lng, maxM); // narrows the table before the exact distance is computed
  const candidates = await db
    .select()
    .from(cellTowers)
    .where(
      and(
        gte(cellTowers.lat, box.minLat),
        lte(cellTowers.lat, box.maxLat),
        gte(cellTowers.lng, box.minLng),
        lte(cellTowers.lng, box.maxLng),
      ),
    );
  const found = nearestTower(candidates, lat, lng, maxM);
  return found ? { ...found.tower, distanceM: found.distanceM } : null;
}
