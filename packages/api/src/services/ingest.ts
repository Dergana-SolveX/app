import type { Database } from "@solvex-dergana/db";
import { medicalProfiles, rawAlerts, smsLog, vehicles } from "@solvex-dergana/db/schema/index";
import {
  decodeSvx,
  deriveDeviceKey,
  GEOHASH8_ACCURACY_M,
  geohashDecode,
  trustedEventTime,
  verifySvx,
} from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { placeAlert, type Placement } from "./clustering";
import type { EventBus } from "./events";
import { retriageIncident } from "./triage";

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

export type IngestDeps = { db: Database; events: EventBus; masterDeviceSecret?: string };

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
export async function ingestSms({ db, events, masterDeviceSecret }: IngestDeps, sms: InboundSms): Promise<IngestResult> {
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

    // The medical profile the sender registered, if the code matches one (feeds the profile-risk rules).
    const [profile] = alert.profileCode
      ? await db.select({ id: medicalProfiles.id }).from(medicalProfiles).where(eq(medicalProfiles.shortCode, alert.profileCode))
      : [];

    let vehicleId: string | null = null;
    let authenticated: boolean | null = null;

    if (alert.layer === 1) {
      // Chip SMS: authenticated by sender MSISDN = vehicles.sim_msisdn AND the H field (PRD FR-S3-13)
      const [vehicle] = await db
        .select({
          id: vehicles.id,
          deviceId: vehicles.deviceId,
          ownerProfileId: vehicles.ownerProfileId,
        })
        .from(vehicles)
        .where(eq(vehicles.simMsisdn, sms.from));

      if (vehicle && masterDeviceSecret) {
        const key = await deriveDeviceKey(masterDeviceSecret, vehicle.deviceId);
        const valid = await verifySvx(sms.body, key);
        authenticated = valid;
        vehicleId = vehicle.id;
      } else {
        authenticated = false;
        vehicleId = vehicle?.id ?? null;
      }
    }

    // Where and when it happened. A late SMS keeps its true time, a wrong device clock is ignored.
    const cell = alert.geohash ? geohashDecode(alert.geohash) : null;
    const position = cell ? { lat: cell.lat, lng: cell.lng, accuracyM: GEOHASH8_ACCURACY_M } : null;
    const eventAt = trustedEventTime(
      alert.eventMinutes === null ? null : new Date(alert.eventMinutes * 60_000),
      receivedAt,
    );

    const [matchedVehicle] = vehicleId
      ? await db.select({ ownerProfileId: vehicles.ownerProfileId }).from(vehicles).where(eq(vehicles.id, vehicleId))
      : [];
    const finalProfileId = profile?.id ?? matchedVehicle?.ownerProfileId ?? null;

    // The stored alert, the same for a recognised SVX message and for plain text.
    const alertRow = {
      profileId: finalProfileId,
      vehicleId,
      authenticated,
      source: sourceOf(alert.layer, alert.peakG),
      channel: "sms" as const,
      receivedAt,
      geohash: alert.geohash,
      gForce: alert.peakG,
      rollover: alert.rollover,
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
    // A retry of an SMS we already stored needs no clustering (and no lock).
    const placement: Placement =
      seen?.incidentId != null
        ? { kind: "duplicate" }
        : await placeAlert(db, { alertRow, position, eventAt });
    const duplicate = placement.kind === "duplicate";

    // Told to dispatchers as soon as the incident is committed: a failure to write the SMS log below
    // must never hide a distress signal from them (NFR-P6).
    // Triage first, so what dispatchers see already carries the recommendation. If triage itself fails,
    // announce the incident as it is: the signal still gets through.
    if (placement.kind === "created" || placement.kind === "merged") {
      const triaged = await retriageIncident({ db, events }, placement.incident.id, { announce: false }).catch(
        () => null,
      );
      const incident = triaged ?? placement.incident;
      events.publish({ type: placement.kind === "created" ? "incident.created" : "incident.updated", incident });
    }
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
