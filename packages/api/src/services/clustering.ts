import type { Database } from "@solvex-dergana/db";
import { masterIncidents, rawAlerts } from "@solvex-dergana/db/schema/index";
import {
  boundingBox,
  confidence,
  pickNearest,
  shouldMerge,
  THRESHOLDS,
  type ConfidenceAlert,
} from "@solvex-dergana/shared";
import { and, eq, gte, inArray, lte, sql, TransactionRollbackError } from "drizzle-orm";

type Incident = typeof masterIncidents.$inferSelect;
type AlertRow = typeof rawAlerts.$inferInsert;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Incidents that can still absorb a new alert. Closed and false-alarm ones never do. */
const MERGEABLE = ["open", "dispatched", "on_scene", "transporting"] as const;

/** Arbitrary constant: the transaction-level lock that serialises clustering. */
const CLUSTER_LOCK_KEY = 4_007_001;

export type Placement =
  | { kind: "created" | "merged"; incident: Incident }
  /** An identical alert was stored first (a retry, or two copies arriving at once). */
  | { kind: "duplicate" };

export type PlacementInput = {
  /** The raw alert to store, without the incident it will belong to. */
  alertRow: Omit<AlertRow, "incidentId" | "mergeTentative">;
  /** Where the alert says it happened, with its accuracy in metres. Null when unknown. */
  position: { lat: number; lng: number; accuracyM: number } | null;
  /** The trusted time of the event. */
  eventAt: Date;
};

type StoredAlert = Pick<AlertRow, "source" | "parseErrors" | "authenticated">;

/** What the confidence formula needs from a stored alert. Null for alerts of unknown source. */
function toConfidenceAlert(row: StoredAlert): ConfidenceAlert | null {
  if (row.source === undefined || row.source === "unknown") return null;
  const errors = row.parseErrors ?? [];
  return {
    source: row.source,
    crcValid: !errors.includes("bad_crc") && !errors.includes("missing_crc"),
    authenticated: row.authenticated ?? null,
  };
}

const confidenceOf = (rows: StoredAlert[]) =>
  confidence(rows.flatMap((row) => toConfidenceAlert(row) ?? []));

/** The existing incident this alert most likely belongs to (PRD FR-S2-08), locked for update. */
async function findMergeTarget(
  tx: Tx,
  position: NonNullable<PlacementInput["position"]>,
  eventAt: Date,
) {
  const { windowMin, baseDistanceM, uncertaintyCapM } = THRESHOLDS.cluster;
  const box = boundingBox(position.lat, position.lng, baseDistanceM + uncertaintyCapM);
  const windowMs = windowMin * 60_000;

  const candidates = await tx
    .select()
    .from(masterIncidents)
    .where(
      and(
        inArray(masterIncidents.status, [...MERGEABLE]),
        gte(masterIncidents.lat, box.minLat),
        lte(masterIncidents.lat, box.maxLat),
        gte(masterIncidents.lng, box.minLng),
        lte(masterIncidents.lng, box.maxLng),
        gte(masterIncidents.lastAlertAt, new Date(eventAt.getTime() - windowMs)),
        lte(masterIncidents.lastAlertAt, new Date(eventAt.getTime() + windowMs)),
      ),
    )
    .for("update");

  const matches = candidates.flatMap((incident) => {
    const decision = shouldMerge(
      { lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, eventAt },
      {
        lat: incident.lat,
        lng: incident.lng,
        uncertaintyM: incident.locationUncertaintyM,
        lastAlertAt: incident.lastAlertAt,
      },
    );
    return decision.merge
      ? [{ incident, distanceM: decision.distanceM, tentative: decision.tentative }]
      : [];
  });
  return pickNearest(matches);
}

const largest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

/**
 * Stores an alert and attaches it to an incident: an existing one that matches (PRD FR-S2-08), or a new one.
 * Runs in one transaction under a lock, so alerts arriving together cannot each open their own incident
 * for the same crash (FR-S3-05).
 */
export async function placeAlert(db: Database, input: PlacementInput): Promise<Placement> {
  const { alertRow, position, eventAt } = input;

  return db
    .transaction(async (tx): Promise<Placement> => {
      // Taken first: even with no incident to lock yet, only one alert is placed at a time.
      await tx.execute(sql`select pg_advisory_xact_lock(${CLUSTER_LOCK_KEY})`);
      const target = position ? await findMergeTarget(tx, position, eventAt) : null;

      if (target) {
        const stored = await tx
          .insert(rawAlerts)
          .values({ ...alertRow, incidentId: target.incident.id, mergeTentative: target.tentative })
          .onConflictDoNothing({ target: rawAlerts.dedupeKey })
          .returning({ id: rawAlerts.id });
        if (stored.length === 0) tx.rollback();

        const alerts = await tx
          .select({
            source: rawAlerts.source,
            parseErrors: rawAlerts.parseErrors,
            authenticated: rawAlerts.authenticated,
          })
          .from(rawAlerts)
          .where(eq(rawAlerts.incidentId, target.incident.id));

        const incident = target.incident;
        // The incident takes the position of its most accurate alert.
        const moreAccurate =
          position !== null &&
          (incident.locationUncertaintyM === null || position.accuracyM < incident.locationUncertaintyM);

        const [updated] = await tx
          .update(masterIncidents)
          .set({
            alertCount: alerts.length,
            version: incident.version + 1,
            firstAlertAt: eventAt < incident.firstAlertAt ? eventAt : incident.firstAlertAt,
            lastAlertAt: eventAt > incident.lastAlertAt ? eventAt : incident.lastAlertAt,
            estimatedVictims: largest(incident.estimatedVictims, alertRow.victims ?? null),
            confidenceScore: confidenceOf(alerts).toFixed(3),
            ...(moreAccurate
              ? {
                  lat: position.lat,
                  lng: position.lng,
                  geohash8: alertRow.geohash ?? null,
                  locationUncertaintyM: position.accuracyM,
                }
              : {}),
          })
          .where(eq(masterIncidents.id, incident.id))
          .returning();
        return { kind: "merged", incident: updated! };
      }

      const [incident] = await tx
        .insert(masterIncidents)
        .values({
          lat: position?.lat ?? null,
          lng: position?.lng ?? null,
          geohash8: alertRow.geohash ?? null,
          locationUncertaintyM: position?.accuracyM ?? null,
          firstAlertAt: eventAt,
          lastAlertAt: eventAt,
          alertCount: 1,
          estimatedVictims: alertRow.victims ?? null,
          confidenceScore: confidenceOf([alertRow]).toFixed(3),
        })
        .returning();
      const stored = await tx
        .insert(rawAlerts)
        .values({ ...alertRow, incidentId: incident!.id })
        .onConflictDoNothing({ target: rawAlerts.dedupeKey })
        .returning({ id: rawAlerts.id });
      if (stored.length === 0) tx.rollback();
      return { kind: "created", incident: incident! };
    })
    .catch((error): Placement => {
      if (error instanceof TransactionRollbackError) return { kind: "duplicate" };
      throw error;
    });
}
