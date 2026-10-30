import type { Database } from "@solvex-dergana/db";
import { masterIncidents, rawAlerts, smsLog } from "@solvex-dergana/db/schema/index";
import type { EventBus } from "./events";
import { retriageIncident } from "./triage";
import { decodeSvx } from "@solvex-dergana/shared";
import { eq, TransactionRollbackError } from "drizzle-orm";
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
  const alert = decoded.alert;
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

  try {
    const [seen] = await db
      .select({ incidentId: rawAlerts.incidentId })
      .from(rawAlerts)
      .where(eq(rawAlerts.dedupeKey, dedupeKey));

    // The stored alert, the same for a recognised SVX message and for plain text.
    const alertRow = {
      source: sourceOf(alert.layer, alert.peakG),
      channel: "sms" as const,
      receivedAt,
      geohash: alert.geohash,
      gForce: alert.peakG,
      deltaVKmh: alert.deltaVKmh,
      fire: alert.fire,
      victims: alert.victims,
      conscious: alert.conscious,
      trapped: alert.trapped,
      bleeding: alert.bleeding,
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
      // `dedupe_key` is unique: if an identical SMS lands at the same moment, the second insert is a no-op.
      const inserted = seen
        ? []
        : await db
            .insert(rawAlerts)
            .values({ ...alertRow, incidentId: null })
            .onConflictDoNothing({ target: rawAlerts.dedupeKey })
            .returning({ id: rawAlerts.id });
      await db
        .update(smsLog)
        .set({ result: { ...result, ...(inserted.length === 0 ? { duplicate: true } : {}) } })
        .where(eq(smsLog.id, logged!.id));
      return { kind: "ignored", reason: "not_svx" };
    }

    // Open an incident for this alert. If an identical SMS won a race and already stored the alert,
    // the unique key makes our insert a no-op: roll our incident back and use the winner's.
    const created =
      seen?.incidentId != null
        ? null
        : await db
            .transaction(async (tx) => {
              const [incident] = await tx
                .insert(masterIncidents)
                .values({
                  geohash8: alert.geohash,
                  firstAlertAt: receivedAt,
                  lastAlertAt: receivedAt,
                  alertCount: 1,
                  estimatedVictims: alert.victims,
                })
                .returning();
              const stored = await tx
                .insert(rawAlerts)
                .values({ ...alertRow, incidentId: incident!.id })
                .onConflictDoNothing({ target: rawAlerts.dedupeKey })
                .returning({ id: rawAlerts.id });
              if (stored.length === 0) tx.rollback();
              return incident!;
            })
            .catch((error) => {
              if (error instanceof TransactionRollbackError) return null;
              throw error;
            });

    const duplicate = created === null;
    const incidentId = created
      ? created.id
      : (seen?.incidentId ??
        (
          await db
            .select({ incidentId: rawAlerts.incidentId })
            .from(rawAlerts)
            .where(eq(rawAlerts.dedupeKey, dedupeKey))
        )[0]!.incidentId!);

    await db
      .update(smsLog)
      .set({ incidentId, result: { ...result, ...(duplicate ? { duplicate: true } : {}) } })
      .where(eq(smsLog.id, logged!.id));

    if (created) {
      // Triage before announcing, so the first thing dispatchers see already carries the recommendation.
      const triaged = await retriageIncident({ db, events }, created.id, { announce: false });
      events.publish({ type: "incident.created", incident: triaged ?? created });
    }

    return { kind: "alert", incidentId, ack: ackFor(incidentId), duplicate };
  } catch (error) {
    // Keep the record, mark it failed, and let the caller see the error (the gateway can retry).
    await db
      .update(smsLog)
      .set({ status: "failed" })
      .where(eq(smsLog.id, logged!.id))
      .catch(() => undefined);
    throw error;
  }
}
