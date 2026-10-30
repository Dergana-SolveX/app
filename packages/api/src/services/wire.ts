import type { Database } from "@solvex-dergana/db";
import { smsLog } from "@solvex-dergana/db/schema/index";
import { desc, eq } from "drizzle-orm";

/** The most recent SMS in both directions, newest first, with what the pipeline learned about each. */
export async function listWireLog(db: Database, limit = 200) {
  const rows = await db.select().from(smsLog).orderBy(desc(smsLog.at)).limit(limit);
  return rows.map(({ msisdnHash: _hash, ...row }) => ({ ...row, size: row.body.length }));
}

/** SMS the server sent (acks, notifications), newest first: the "Boîte d'envoi GSM". */
export async function listOutbox(db: Database, limit = 100) {
  const rows = await db
    .select()
    .from(smsLog)
    .where(eq(smsLog.direction, "out"))
    .orderBy(desc(smsLog.at))
    .limit(limit);
  return rows.map(({ msisdnHash: _hash, ...row }) => ({ ...row, size: row.body.length }));
}
