import type { EventBus } from "@solvex-dergana/api/services/events";
import { receiveSms } from "@solvex-dergana/api/services/sms-flow";
import { applyDeliveryReport } from "@solvex-dergana/api/services/wire";
import type { SmsTransport } from "@solvex-dergana/api/sms/transport";
import type { Database } from "@solvex-dergana/db";
import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const inboundSchema = z.object({
  from: z.string().min(1),
  body: z.string(),
  receivedAt: z.coerce.date().optional(),
  /** A real gateway leaves this false; the emulated GSM network sets it to true. */
  emulated: z.boolean().default(false),
});

/** What the network finally did with a text the modem sent (from the gateway, see apps/gateway). */
const deliveryReportSchema = z.object({ ref: z.number().int(), status: z.enum(["delivered", "failed"]) });

const MIN_SECRET_LENGTH = 16;

const digest = (text: string) => createHash("sha256").update(text).digest();

/** `Authorization: Bearer <secret>`, compared in constant time. */
function isAuthorized(header: string | undefined, secret: string): boolean {
  const given = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(digest(given), digest(secret));
}

/**
 * The one door every SMS gateway (emulator, Android relay, USB modem) uses to hand an SMS to the server.
 * Replies to send back to the sender are returned in the response, so a gateway needs no second channel.
 */
export function createInternalSmsApp({
  secret,
  db,
  transport,
  events,
  masterDeviceSecret,
}: {
  secret: string;
  db: Database;
  transport: SmsTransport;
  events: EventBus;
  masterDeviceSecret?: string;
}) {
  // A blank or guessable secret would make the endpoint effectively public.
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`GATEWAY_SHARED_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const app = new Hono();

  app.post("/internal/sms", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const parsed = inboundSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    const result = await receiveSms({ db, events, transport, masterDeviceSecret }, parsed.data);
    const texts =
      result.kind === "alert" ? [result.ack] : result.kind === "menu" ? result.replies : [];
    // The modem and android transports have already texted them through the gateway: returning them too would text the phone twice.
    const replies =
      transport.kind === "modem" || transport.kind === "android"
        ? []
        : texts.map((body) => ({ to: parsed.data.from, body }));
    return c.json({ result, replies });
  });

  app.post("/internal/sms/status", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const parsed = deliveryReportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    return c.json({ updated: await applyDeliveryReport(db, parsed.data) });
  });

  return app;
}
