import type { Database } from "@solvex-dergana/db";
import { cellTowers } from "@solvex-dergana/db/schema/index";
import { boundingBox, nearestTower, validateCellSurvey, type CellSurveyInput } from "@solvex-dergana/shared";
import { and, eq, gte, lte, sql } from "drizzle-orm";

/** Never scan more than this around a point, whatever the caller asks for. */
const MAX_SEARCH_M = 50_000;
/** The few closest towers kept for the exact distance. */
const CANDIDATES = 20;

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
  const box = boundingBox(lat, lng, Math.min(maxM, MAX_SEARCH_M)); // narrows the table before the exact distance is computed
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
    )
    // Closest first (flat-earth distance is plenty to rank them); the exact distance is computed on the few we keep.
    .orderBy(sql`power(${cellTowers.lat} - ${lat}, 2) + power((${cellTowers.lng} - ${lng}) * cos(radians(${lat})), 2)`)
    .limit(CANDIDATES);
  const found = nearestTower(candidates, lat, lng, maxM);
  return found ? { ...found.tower, distanceM: found.distanceM } : null;
}

/**
 * Records a cell survey (Cell-ID, GPS) pair into `cell_towers` with `source = 'survey'` (PRD FR-S4-08).
 * If the tower already exists, its coordinates are updated with the latest survey location.
 */
export async function recordCellSurvey(db: Database, input: CellSurveyInput) {
  const validated = validateCellSurvey(input);
  await db
    .insert(cellTowers)
    .values({
      mcc: validated.mcc,
      mnc: validated.mnc,
      lac: validated.lac,
      cid: validated.cid,
      lat: validated.lat,
      lng: validated.lng,
      rangeM: validated.rangeM,
      source: "survey",
    })
    .onConflictDoUpdate({
      target: [cellTowers.mcc, cellTowers.mnc, cellTowers.lac, cellTowers.cid],
      set: {
        lat: validated.lat,
        lng: validated.lng,
        rangeM: validated.rangeM,
        source: "survey",
      },
    });

  return { ok: true as const, tower: validated };
}

/**
 * Returns surveyed towers with `source = 'survey'`.
 */
export async function listSurveyTowers(db: Database, limit = 50) {
  return db
    .select()
    .from(cellTowers)
    .where(eq(cellTowers.source, "survey"))
    .limit(limit);
}
