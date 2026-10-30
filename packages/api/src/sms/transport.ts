import type { Database } from "@solvex-dergana/db";
import { smsLog } from "@solvex-dergana/db/schema/index";
import { createHash } from "node:crypto";

/** How the server sends an SMS to a phone. One adapter per way of reaching the GSM network. */
export type SmsTransport = {
  kind: "emulator" | "android" | "modem";
  send(to: string, body: string, meta?: { incidentId?: string }): Promise<void>;
};

/**
 * The emulated GSM network (stage default): nothing leaves the machine. The SMS is recorded as
 * sent and flagged `emulated`, and the "Boîte d'envoi GSM" panel reads it from the log.
 */
function createEmulatorTransport({ db }: { db: Database }): SmsTransport {
  return {
    kind: "emulator",
    async send(to, body, meta) {
      await db.insert(smsLog).values({
        direction: "out",
        msisdnHash: createHash("sha256").update(to).digest("hex"),
        body,
        status: "sent",
        emulated: true,
        incidentId: meta?.incidentId ?? null,
      });
    },
  };
}

/** Picks the transport named by `SMS_TRANSPORT`. */
export function createTransport(kind: string, deps: { db: Database }): SmsTransport {
  switch (kind) {
    case "emulator":
      return createEmulatorTransport(deps);
    case "android":
    case "modem":
      throw new Error(`SMS transport "${kind}" is not implemented yet (see issues #25 and #26)`);
    default:
      throw new Error(`Unknown SMS transport "${kind}" (expected emulator, android or modem)`);
  }
}
