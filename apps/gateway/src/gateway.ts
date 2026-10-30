import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { SmsTooLongError } from "./modem/driver";
import { ModemUnavailableError, type ModemService } from "./modem/service";

type Log = Pick<Console, "info" | "warn" | "error">;

export type GatewayOptions = {
  modem: Pick<ModemService, "onMessage" | "onDeliveryReport" | "send" | "status">;
  /** Base URL of the SVX server, e.g. `http://localhost:3000`. */
  serverUrl: string;
  /** `GATEWAY_SHARED_SECRET`: sent to the server, and required from the server on `/send`. */
  secret: string;
  fetch?: typeof globalThis.fetch;
  /** How many times to try the server when it is unreachable or fails (5xx). */
  retries?: number;
  retryDelayMs?: number;
  log?: Log;
};

const serverAnswer = z.object({ replies: z.array(z.object({ to: z.string(), body: z.string() })).default([]) });

const sendRequest = z.object({ to: z.string().min(1).max(32), body: z.string().min(1).max(1000) });

const digest = (text: string) => createHash("sha256").update(text).digest();

/** `Authorization: Bearer <secret>`, compared in constant time. */
function isAuthorized(header: string | undefined, secret: string): boolean {
  const given = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(digest(given), digest(secret));
}

/**
 * The SMS gateway (PLAN.md S3.4-A): every SMS the modem receives goes to the SVX server (`POST /internal/sms`),
 * the texts the server wants sent go out through the modem (`POST /send`), and delivery reports go back to the server.
 */
export function createGateway({
  modem,
  serverUrl,
  secret,
  fetch: fetchImpl = fetch,
  retries = 3,
  retryDelayMs = 500,
  log = console,
}: GatewayOptions) {
  /** Posts to the server. Retries what retrying can fix (network errors, 5xx); anything else fails at once. */
  async function post(path: string, body: unknown): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      let response: Response;
      try {
        response = await fetchImpl(new URL(path, serverUrl), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: JSON.stringify(body),
        });
      } catch (error) {
        lastError = error; // the server could not be reached
        continue;
      }
      if (response.ok) return response;
      lastError = new Error(`The server answered ${response.status} to ${path}`);
      if (response.status < 500) throw lastError; // wrong secret, bad request: trying again changes nothing
    }
    throw lastError;
  }

  // The modem deletes a message once this returns: if the server could not be reached it throws, so the message
  // stays on the SIM and the next sweep offers it again (a distress signal is never dropped).
  modem.onMessage(async (sms) => {
    const response = await post("/internal/sms", {
      from: sms.from,
      body: sms.body,
      receivedAt: sms.receivedAt.toISOString(),
      emulated: false,
    });
    const { replies } = serverAnswer.parse(await response.json());
    for (const reply of replies) {
      // The server has the message: a reply that cannot go out must not undo that. A phone that gets no
      // acknowledgement sends again, and the server recognises the repeat.
      await modem.send(reply.to, reply.body).catch((error) => log.error("[gateway] could not text back", error));
    }
  });

  modem.onDeliveryReport((report) => {
    void post("/internal/sms/status", report).catch((error) => log.error("[gateway] could not report delivery", error));
  });

  const app = new Hono();

  app.get("/health", (c) => c.json({ modem: modem.status() }));

  app.post("/send", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), secret)) return c.json({ error: "unauthorized" }, 401);
    const parsed = sendRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    try {
      return c.json(await modem.send(parsed.data.to, parsed.data.body));
    } catch (error) {
      if (error instanceof SmsTooLongError) return c.json({ error: "too_long" }, 422);
      if (error instanceof ModemUnavailableError) return c.json({ error: "modem_unavailable" }, 503);
      log.error("[gateway] send failed", error);
      return c.json({ error: "send_failed" }, 502);
    }
  });

  return { app };
}
