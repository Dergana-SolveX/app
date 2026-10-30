import type { Database } from "@solvex-dergana/db";
import { masterIncidents, rawAlerts, smsLog } from "@solvex-dergana/db/schema/index";
import type { EventBus } from "./events";
import { decodeSvx } from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

export type InboundSms = {
  /** Sender phone number (E.164). Only a hash of it is stored. */
  from: string;
  body: string;
  receivedAt?: Date;
  /** True when the SMS came through the emulated GSM network. */
  emulated: boolean;
};

export type IngestResult =
  | {
      kind: "alert";
      incidentId: string;
      /** The reply to send back to the sender. */
      ack: string;
      /** True when this exact SMS had already been ingested. */
      duplicate: boolean;
    }
  /** Not an SVX alert: kept on record, no incident, no reply. */
  | { kind: "ignored"; reason: "not_svx" };

export type IngestDeps = { db: Database; events: EventBus };

const sha = (algorithm: "sha1" | "sha256", text: string) =>
  createHash(algorithm).update(text).digest("hex");

/** `SVXACK#` plus 8 characters of the incident id: stable, so a repeated SMS gets the same reply. */
export const ackFor = (incidentId: string) =>
  `SVXACK#${incidentId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/** Layer 2 reports carry peak g only when the phone detected the crash itself. */
function sourceOf(layer: number | null, peakG: number | null) {
  if (layer === 1) return "iot" as const;
  if (layer === 2) return peakG === null ? ("app_witness" as const) : ("app_auto" as const);
  if (layer === 3) return "ussd" as const;
  return "unknown" as const;
}

/** SMS in: stores the alert, opens an incident and returns the acknowledgement. */
export async function ingestSms({ db, events }: IngestDeps, sms: InboundSms): Promise<IngestResult> {
  const receivedAt = sms.receivedAt ?? new Date();
  const senderHash = sha("sha256", sms.from);
  const decoded = decodeSvx(sms.body);
  const a = decoded.alert;
  const dedupeKey = sha("sha1", sms.body + senderHash);

  // Logged first so the SMS is on record even if something below fails (never drop a signal).
  const [logged] = await db
    .insert(smsLog)
    .values({
      direction: "in",
      msisdnHash: senderHash,
      body: sms.body,
      status: "received",
      at: receivedAt,
      emulated: sms.emulated,
    })
    .returning({ id: smsLog.id });

  const [seen] = await db
    .select({ incidentId: rawAlerts.incidentId })
    .from(rawAlerts)
    .where(eq(rawAlerts.dedupeKey, dedupeKey));

  // The stored alert, the same for a recognised SVX message and for plain text.
  const alertRow = {
    source: sourceOf(a.layer, a.peakG),
    channel: "sms" as const,
    receivedAt,
    geohash: a.geohash,
    gForce: a.peakG,
    deltaVKmh: a.deltaVKmh,
    fire: a.fire,
    victims: a.victims,
    conscious: a.conscious,
    trapped: a.trapped,
    bleeding: a.bleeding,
    rawPayload: sms.body,
    parseErrors: decoded.parseErrors,
    senderMsisdnHash: senderHash,
    dedupeKey,
    emulated: sms.emulated,
  };
  const result = {
    recognized: decoded.recognized,
    crcValid: decoded.crcValid,
    parseErrors: decoded.parseErrors,
  };

  if (!decoded.recognized) {
    if (!seen) await db.insert(rawAlerts).values({ ...alertRow, incidentId: null });
    await db
      .update(smsLog)
      .set({ result: { ...result, ...(seen ? { duplicate: true } : {}) } })
      .where(eq(smsLog.id, logged!.id));
    return { kind: "ignored", reason: "not_svx" };
  }

  const duplicate = seen?.incidentId != null;
  const created = duplicate
    ? null
    : await db.transaction(async (tx) => {
        const [incident] = await tx
          .insert(masterIncidents)
          .values({
            geohash8: a.geohash,
            firstAlertAt: receivedAt,
            lastAlertAt: receivedAt,
            alertCount: 1,
            estimatedVictims: a.victims,
          })
          .returning();
        await tx.insert(rawAlerts).values({ ...alertRow, incidentId: incident!.id });
        return incident!;
      });
  const incidentId = created ? created.id : seen!.incidentId!;

  await db
    .update(smsLog)
    .set({ incidentId, result: { ...result, ...(duplicate ? { duplicate: true } : {}) } })
    .where(eq(smsLog.id, logged!.id));

  if (created) events.publish({ type: "incident.created", incident: created });

  return { kind: "alert", incidentId, ack: ackFor(incidentId), duplicate };
}
