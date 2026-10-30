import type { EventBus } from "@solvex-dergana/api/services/events";
import { handleUssd } from "@solvex-dergana/api/services/ussd";
import type { Database } from "@solvex-dergana/db";
import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** The aggregator convention: `sessionId`, `serviceCode`, `phoneNumber`, `text` (answers joined by `*`). */
const callbackSchema = z.object({
  sessionId: z.string().min(1).max(128),
  serviceCode: z.string().max(32).default(""),
  phoneNumber: z.string().min(1).max(32),
  text: z.string().max(200).default(""),
  /** The cell the call is on, decimal `mcc-mnc-lac-cid`: a real operator supplies it in the callback. */
  cellId: z.string().max(40).optional(),
});

const digest = (text: string) => createHash("sha256").update(text).digest();

/** `Authorization: Bearer <secret>`, compared in constant time. */
function isAuthorized(header: string | undefined, secret: string): boolean {
  const given = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(digest(given), digest(secret));
}

/**
 * `POST /webhooks/ussd`: where a USSD aggregator (or an operator) sends each step of a `*140#` dialogue.
 * The answer is plain text: `CON <next question>` or `END <last message>`. Plugging in a real operator is a
 * configuration change; the secret is the same one the SMS gateway uses.
 */
export function createUssdApp({ secret, db, events }: { secret: string; db: Database; events: EventBus }) {
  const app = new Hono();

  app.post("/webhooks/ussd", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), secret)) return c.json({ error: "unauthorized" }, 401);

    const isJson = c.req.header("content-type")?.includes("application/json");
    const raw = isJson ? await c.req.json().catch(() => null) : await c.req.parseBody().catch(() => null);
    const parsed = callbackSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    // A real operator is not our emulator: its alerts are not flagged emulated.
    const { type, message } = await handleUssd({ db, events }, parsed.data, { emulated: false });
    return c.text(`${type} ${message}`);
  });

  return app;
}
