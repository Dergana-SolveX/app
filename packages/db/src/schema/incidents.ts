import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { alertChannel, alertSource, authority, incidentStatus, severity } from "./enums";
import { medicalProfiles, vehicles } from "./profiles";

export type RecUnit = { type: string; count: number; reason?: string };
export type VittelItem = { value: boolean | number | string; source: "iot" | "app" | "medic" };
export type VittelState = Record<"l1" | "l2" | "l3" | "l4" | "l5", Record<string, VittelItem>>;

export const masterIncidents = pgTable(
  "master_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geohash8: text("geohash8"),
    locationUncertaintyM: integer("location_uncertainty_m"),
    firstAlertAt: timestamp("first_alert_at", { withTimezone: true }).notNull(),
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }).notNull(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }).notNull().default("0"),
    alertCount: integer("alert_count").notNull().default(0),
    status: incidentStatus("status").notNull().default("open"),
    recSeverity: severity("rec_severity").notNull().default("unknown"),
    recUnits: jsonb("rec_units").$type<RecUnit[]>(),
    recAuthority: authority("rec_authority"),
    /** AI-derived facts, always labelled as such in the UI. */
    aiSummary: jsonb("ai_summary").$type<Record<string, unknown>>(),
    vittelPrefill: jsonb("vittel_prefill").$type<Partial<VittelState>>(),
    linkedProfileIds: uuid("linked_profile_ids").array().notNull().default([]),
    estimatedVictims: integer("estimated_victims"),
    pkMarker: text("pk_marker"),
    commune: text("commune"),
    roadRef: text("road_ref"),
    /** Optimistic lock for concurrent dispatchers. */
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("master_incidents_status_last_alert_idx").on(t.status, t.lastAlertAt),
    index("master_incidents_lat_lng_idx").on(t.lat, t.lng),
  ],
);

export const rawAlerts = pgTable(
  "raw_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null until clustered. Append-only: clustering and split only re-point this. */
    incidentId: uuid("incident_id").references(() => masterIncidents.id),
    source: alertSource("source").notNull(),
    channel: alertChannel("channel").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    /** Device time; earlier than receivedAt for queued SMS. */
    eventAt: timestamp("event_at", { withTimezone: true }),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geohash: text("geohash"),
    accuracyM: integer("accuracy_m"),
    gForce: doublePrecision("g_force"),
    deltaVKmh: doublePrecision("delta_v_kmh"),
    rolloverDeg: doublePrecision("rollover_deg"),
    fire: boolean("fire"),
    victims: integer("victims"),
    conscious: integer("conscious"),
    trapped: boolean("trapped"),
    bleeding: boolean("bleeding"),
    profileId: uuid("profile_id").references(() => medicalProfiles.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    /** Exact SMS/USSD string. */
    rawPayload: text("raw_payload"),
    media: jsonb("media").$type<{ photos?: string[]; audio?: string }>(),
    transcript: text("transcript"),
    transcriptLang: text("transcript_lang"),
    parseErrors: jsonb("parse_errors").$type<string[]>(),
    senderMsisdnHash: text("sender_msisdn_hash"),
    /** sha1(raw_payload + sender) for SMS, device_id + event_at for IoT, client key for apps. */
    dedupeKey: text("dedupe_key").unique(),
    emulated: boolean("emulated").notNull().default(false),
    traceInjected: boolean("trace_injected").notNull().default(false),
    impacts: integer("impacts"),
    saturated: boolean("saturated"),
    /** Chip SMS: sender MSISDN and H field matched. Null for non-chip alerts. */
    authenticated: boolean("authenticated"),
  },
  (t) => [
    index("raw_alerts_received_at_idx").on(t.receivedAt),
    index("raw_alerts_incident_id_idx").on(t.incidentId),
  ],
);

export const dispatches = pgTable("dispatches", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => masterIncidents.id),
  recommended: jsonb("recommended").$type<Record<string, unknown>>().notNull(),
  decided: jsonb("decided").$type<Record<string, unknown>>().notNull(),
  modified: boolean("modified").notNull().default(false),
  modificationReason: text("modification_reason"),
  dispatcherId: uuid("dispatcher_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  unitIds: uuid("unit_ids").array().notNull().default([]),
  authorityNotified: boolean("authority_notified").notNull().default(false),
  authorityNotifiedAt: timestamp("authority_notified_at", { withTimezone: true }),
});

export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id").references(() => masterIncidents.id),
    actorRole: text("actor_role").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("incident_events_incident_at_idx").on(t.incidentId, t.at)],
);
