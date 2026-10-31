import type { Database } from "@solvex-dergana/db";
import { smsLog } from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

/** How the server sends an SMS to a phone. One adapter per way of reaching the GSM network. */
export type SmsTransport = {
  kind: "emulator" | "android" | "modem";
  send(to: string, body: string, meta?: { incidentId?: string }): Promise<void>;
};

/** Where `apps/gateway` (the process that owns the USB modem) listens. */
export type GatewayConfig = {
  /** Base URL, e.g. `http://localhost:3002`. */
  url: string;
  /** `GATEWAY_SHARED_SECRET`, the same one the gateway uses towards `/internal/sms`. */
  secret: string;
  fetch?: typeof globalThis.fetch;
  /** How long to wait for the gateway to accept a text (the modem may take a while to hand it to the network). */
  timeoutMs?: number;
};

type Deps = { db: Database; gateway?: GatewayConfig };

const hashOf = (phone: string) => createHash("sha256").update(phone).digest("hex");

/**
 * The emulated GSM network (stage default): nothing leaves the machine. The SMS is recorded as
 * sent and flagged `emulated`, and the "Boîte d'envoi GSM" panel reads it from the log.
 */
function createEmulatorTransport({ db }: Deps): SmsTransport {
  return {
    kind: "emulator",
    async send(to, body, meta) {
      await db.insert(smsLog).values({
        direction: "out",
        msisdnHash: hashOf(to),
        body,
        status: "sent",
        emulated: true,
        incidentId: meta?.incidentId ?? null,
      });
    },
  };
}

async function dispatchGatewaySms(
  db: Database,
  gateway: GatewayConfig,
  to: string,
  body: string,
  meta?: { incidentId?: string },
  parseRef?: (answer: { ref?: unknown } | null) => string,
): Promise<void> {
  const { url, secret, fetch: fetchImpl = fetch, timeoutMs = 40_000 } = gateway;
  const [row] = await db
    .insert(smsLog)
    .values({ direction: "out", msisdnHash: hashOf(to), body, emulated: false, incidentId: meta?.incidentId ?? null, status: "queued" })
    .returning({ id: smsLog.id });
  const settle = (patch: Partial<typeof smsLog.$inferInsert>) => db.update(smsLog).set(patch).where(eq(smsLog.id, row!.id));
  const fail = async (message: string): Promise<never> => {
    await settle({ status: "failed" });
    throw new Error(message);
  };

  let response: Response;
  try {
    response = await fetchImpl(new URL("/send", url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ to, body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return fail(
      error instanceof Error && error.name === "TimeoutError"
        ? `The SMS gateway did not answer within ${timeoutMs} ms`
        : `The SMS gateway could not be reached: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (!response.ok) return fail(`The SMS gateway refused the text (${response.status})`);

  const answer = (await response.json().catch(() => null)) as { ref?: unknown } | null;
  let ref: string;
  try {
    ref = parseRef ? parseRef(answer) : answer?.ref != null ? String(answer.ref) : "gateway-ack";
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  await settle({ status: "sent", modemRef: ref });
}

/**
 * A real SMS through the USB modem: the server hands the text to the gateway process (`POST /send`), which
 * owns the serial port. The log row starts as `sent` (the modem accepted it); the network's delivery report
 * later turns it into `delivered` or `failed` (`POST /internal/sms/status`).
 */
function createModemTransport({ db, gateway }: Deps): SmsTransport {
  if (!gateway) throw new Error("The modem transport needs GATEWAY_URL: where does apps/gateway listen?");

  return {
    kind: "modem",
    async send(to, body, meta) {
      await dispatchGatewaySms(db, gateway, to, body, meta, (answer) => {
        if (typeof answer?.ref !== "number") throw new Error("The SMS gateway accepted the text but gave no network reference");
        return String(answer.ref);
      });
    },
  };
}

/**
 * A real SMS through an Android phone relay (PRD FR-S3-08 / issue #25): the server hands the text
 * to the Android relay gateway (`POST /send`). The log row starts as `queued`, then moves to `sent`.
 */
function createAndroidTransport({ db, gateway }: Deps): SmsTransport {
  if (!gateway) throw new Error("The android transport needs GATEWAY_URL: where does the Android relay gateway listen?");

  return {
    kind: "android",
    async send(to, body, meta) {
      await dispatchGatewaySms(db, gateway, to, body, meta, (answer) => {
        return answer?.ref != null ? String(answer.ref) : "android-relay";
      });
    },
  };
}

/** Picks the transport named by `SMS_TRANSPORT`. */
export function createTransport(kind: string, deps: Deps): SmsTransport {
  switch (kind) {
    case "emulator":
      return createEmulatorTransport(deps);
    case "modem":
      return createModemTransport(deps);
    case "android":
      return createAndroidTransport(deps);
    default:
      throw new Error(`Unknown SMS transport "${kind}" (expected emulator, android or modem)`);
  }
}
