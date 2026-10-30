import { eq, sql } from "drizzle-orm";

import type { Database } from "./index";
import { cellTowers } from "./schema";

/** Algeria's Mobile Country Code: the only network we keep. */
const ALGERIA_MCC = 603;
const BATCH = 1_000;
const MAX_INT32 = 2_147_483_647;
/** No cell covers less than this, whatever the file says (0 means "unknown"): never claim a 1 m fix. */
const MIN_RANGE_M = 500;

type Row = typeof cellTowers.$inferInsert;

/**
 * One line of an OpenCelliD export: `radio,mcc,net,area,cell,unit,lon,lat,range,samples,...`.
 * Returns null for another country, a header, or anything we cannot trust.
 */
function parseLine(line: string): Row | null {
  const [, mcc, net, area, cell, , lon, lat, range] = line.split(",").map((field) => field.trim());
  const whole = (field: string | undefined) => (field !== undefined && /^\d+$/.test(field) ? Number(field) : null);
  const decimal = (field: string | undefined) => (field !== undefined && /^-?\d+(\.\d+)?$/.test(field) ? Number(field) : null);

  if (whole(mcc) !== ALGERIA_MCC) return null;
  const [mnc, lac, cid, rangeM, lng, latN] = [whole(net), whole(area), whole(cell), whole(range), decimal(lon), decimal(lat)];
  if (mnc === null || lac === null || cid === null || rangeM === null || lng === null || latN === null) return null;
  if (lac === 0 || cid === 0) return null; // placeholders, not real cells
  if ([mnc, lac, cid].some((n) => n > MAX_INT32) || Math.abs(latN) > 90 || Math.abs(lng) > 180) return null;
  return { mcc: ALGERIA_MCC, mnc, lac, cid, lat: latN, lng, rangeM: Math.max(MIN_RANGE_M, rangeM), source: "opencellid" };
}

/**
 * Loads an OpenCelliD export (PRD FR-S3-16) into `cell_towers`, keeping only MCC 603.
 * Safe to run again on a newer file. A tower we surveyed ourselves is never overwritten by the open database.
 */
export async function importOpenCellId(db: Database, lines: Iterable<string> | AsyncIterable<string>) {
  let imported = 0;
  let skipped = 0;
  // Keyed by tower: Postgres refuses to update the same row twice in one statement, and the last line should win.
  let batch = new Map<string, Row>();

  const flush = async () => {
    if (batch.size === 0) return;
    const rows = [...batch.values()];
    await db
      .insert(cellTowers)
      .values(rows)
      .onConflictDoUpdate({
        target: [cellTowers.mcc, cellTowers.mnc, cellTowers.lac, cellTowers.cid],
        set: { lat: sql`excluded.lat`, lng: sql`excluded.lng`, rangeM: sql`excluded.range_m` },
        setWhere: eq(cellTowers.source, "opencellid"),
      });
    imported += rows.length;
    batch = new Map();
  };

  for await (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("radio,")) continue; // blank line, header
    const row = parseLine(line);
    if (row) batch.set(`${row.mnc}-${row.lac}-${row.cid}`, row);
    else skipped++;
    if (batch.size >= BATCH) await flush();
  }
  await flush();
  return { imported, skipped };
}
