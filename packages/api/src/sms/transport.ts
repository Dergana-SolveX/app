import type { Database } from "@solvex-dergana/db";
import { smsLog } from "@solvex-dergana/db/schema/index";
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

/**
 * A real SMS through the USB modem: the server hands the text to the gateway process (`POST /send`), which
 * owns the serial port. The log row starts as `sent` (the modem accepted it); the network's delivery report
 * later turns it into `delivered` or `failed` (`POST /internal/sms/status`).
 */
function createModemTransport({ db, gateway }: Deps): SmsTransport {
  if (!gateway) throw new Error("The modem transport needs GATEWAY_URL: where does apps/gateway listen?");
  const { url, secret, fetch: fetchImpl = fetch } = gateway;

  return {
    kind: "modem",
    async send(to, body, meta) {
      const row = { direction: "out" as const, msisdnHash: hashOf(to), body, emulated: false, incidentId: meta?.incidentId ?? null };

      let response: Response;
      try {
        response = await fetchImpl(new URL("/send", url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: JSON.stringify({ to, body }),
        });
      } catch (error) {
        await db.insert(smsLog).values({ ...row, status: "failed" });
        throw new Error(`The SMS gateway could not be reached: ${error instanceof Error ? error.message : error}`);
      }
      if (!response.ok) {
        await db.insert(smsLog).values({ ...row, status: "failed" });
        throw new Error(`The SMS gateway refused the text (${response.status})`);
      }

      const { ref } = (await response.json()) as { ref: number };
      await db.insert(smsLog).values({ ...row, status: "sent", modemRef: String(ref) });
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
      throw new Error(`SMS transport "${kind}" is not implemented yet (see issue #25)`);
    default:
      throw new Error(`Unknown SMS transport "${kind}" (expected emulator, android or modem)`);
  }
}
