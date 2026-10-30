import type { Database } from "@solvex-dergana/db";

import type { SmsTransport } from "../sms/transport";
import type { EventBus } from "./events";
import { ingestSms, type InboundSms } from "./ingest";

export type SmsFlowDeps = { db: Database; events: EventBus; transport: SmsTransport };

/**
 * Everything the server does when an SMS arrives: ingest it, then acknowledge it through the transport.
 * Used by both `POST /internal/sms` (real gateways) and the emulated GSM panel, so the two cannot diverge.
 */
export async function receiveSms({ db, events, transport }: SmsFlowDeps, sms: InboundSms) {
  const result = await ingestSms({ db, events }, sms);
  if (result.kind === "alert") {
    await transport.send(sms.from, result.ack, { incidentId: result.incidentId });
  }
  return result;
}
