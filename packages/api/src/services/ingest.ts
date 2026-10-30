import type { Database } from "@solvex-dergana/db";
import { rawAlerts, smsLog } from "@solvex-dergana/db/schema/index";
import { decodeSvx, geohashDecode, trustedEventTime } from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { placeAlert } from "./clustering";
import type { EventBus } from "./events";

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
      /** True when the alert joined an incident that already existed. */
      merged: boolean;
    }
  /** Not an SVX alert: kept on record, no incident, no reply. */
  | { kind: "ignored"; reason: "not_svx" };

/** A geohash of 8 characters pins a position to about this many metres. */
const GEOHASH8_ACCURACY_M = 19;

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

    // Where and when it happened. A late SMS keeps its true time, a wrong device clock is ignored.
    const cell = alert.geohash ? geohashDecode(alert.geohash) : null;
    const position = cell ? { lat: cell.lat, lng: cell.lng, accuracyM: GEOHASH8_ACCURACY_M } : null;
    const eventAt = trustedEventTime(
      alert.eventMinutes === null ? null : new Date(alert.eventMinutes * 60_000),
      receivedAt,
    );

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
      lat: position?.lat ?? null,
      lng: position?.lng ?? null,
      accuracyM: position?.accuracyM ?? null,
      eventAt,
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

    // Attach it to the incident it belongs to, or open a new one (see clustering.ts).
    const placement = await placeAlert(db, { alertRow, position, eventAt });
    const duplicate = placement.kind === "duplicate";
    const incidentId =
      placement.kind !== "duplicate"
        ? placement.incident.id
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

    if (placement.kind === "created") events.publish({ type: "incident.created", incident: placement.incident });
    if (placement.kind === "merged") events.publish({ type: "incident.updated", incident: placement.incident });

    return {
      kind: "alert",
      incidentId,
      ack: ackFor(incidentId),
      duplicate,
      merged: placement.kind === "merged",
    };
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
