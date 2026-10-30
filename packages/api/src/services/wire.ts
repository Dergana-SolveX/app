import type { Database } from "@solvex-dergana/db";
import { smsLog } from "@solvex-dergana/db/schema/index";
import { and, desc, eq } from "drizzle-orm";

type SmsRow = typeof smsLog.$inferSelect;

/** What the console may see of an SMS: everything except the hash of the phone number, plus its size. */
const forConsole = ({ msisdnHash: _hash, ...row }: SmsRow) => ({ ...row, size: row.body.length });

/** The most recent SMS in both directions, newest first, with what the pipeline learned about each. */
export async function listWireLog(db: Database, limit = 200) {
  const rows = await db.select().from(smsLog).orderBy(desc(smsLog.at)).limit(limit);
  return rows.map(forConsole);
}

/** SMS the server sent (acks, notifications), newest first: the "Boîte d'envoi GSM". */
export async function listOutbox(db: Database, limit = 100) {
  const rows = await db
    .select()
    .from(smsLog)
    .where(eq(smsLog.direction, "out"))
    .orderBy(desc(smsLog.at))
    .limit(limit);
  return rows.map(forConsole);
}

/**
 * The network's last word on a text the modem sent. The modem numbers its texts 0-255 and reuses numbers,
 * so the report belongs to the latest text with that reference that is still waiting for one.
 * Returns whether a text was found.
 */
export async function applyDeliveryReport(db: Database, report: { ref: number; status: "delivered" | "failed" }) {
  const [waiting] = await db
    .select({ id: smsLog.id })
    .from(smsLog)
    .where(and(eq(smsLog.direction, "out"), eq(smsLog.modemRef, String(report.ref)), eq(smsLog.status, "sent")))
    .orderBy(desc(smsLog.at))
    .limit(1);
  if (!waiting) return false;
  await db.update(smsLog).set({ status: report.status }).where(eq(smsLog.id, waiting.id));
  return true;
}
