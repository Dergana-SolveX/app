import type { Database } from "@solvex-dergana/db";

import type { SmsTransport } from "../sms/transport";
import type { EventBus } from "./events";
import { ingestSms, type InboundSms } from "./ingest";
import { handleMenuSms } from "./sms-menu";

export type SmsFlowDeps = {
  db: Database;
  events: EventBus;
  transport: SmsTransport;
  masterDeviceSecret?: string;
};

/**
 * Everything the server does when an SMS arrives: ingest it, then acknowledge it through the transport.
 * Used by both `POST /internal/sms` (real gateways) and the emulated GSM panel, so the two cannot diverge.
 */
export async function receiveSms(deps: SmsFlowDeps, sms: InboundSms) {
  const { db, events, transport, masterDeviceSecret } = deps;
  const menuReplies = await handleMenuSms(deps, sms);
  if (menuReplies) return { kind: "menu" as const, replies: menuReplies };
  const result = await ingestSms({ db, events, masterDeviceSecret }, sms);
  if (result.kind === "alert") {
    await transport.send(sms.from, result.ack, { incidentId: result.incidentId });
  }
  return result;
}
