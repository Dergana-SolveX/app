import {
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { handoverStatus } from "./enums";
import { ambulanceUnits, hospitalsMatrix } from "./hospitals";
import { dispatches, masterIncidents, type VittelState } from "./incidents";
import { medicalProfiles } from "./profiles";

export type HospitalRanking = {
  hospitalId: string;
  etaMin: number;
  matched: string[];
  missing: string[];
  flags?: string[];
}[];

export const medicAssessments = pgTable("medic_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => masterIncidents.id),
  dispatchId: uuid("dispatch_id").references(() => dispatches.id),
  unitId: uuid("unit_id").references(() => ambulanceUnits.id),
  victimIndex: integer("victim_index").notNull().default(1),
  profileId: uuid("profile_id").references(() => medicalProfiles.id, { onDelete: "set null" }),
  estAge: integer("est_age"),
  sex: text("sex", { enum: ["male", "female", "unknown"] }),
  vittel: jsonb("vittel").$type<Partial<VittelState>>(),
  gcs: integer("gcs"),
  hr: integer("hr"),
  sbp: integer("sbp"),
  dbp: integer("dbp"),
  spo2: integer("spo2"),
  rr: integer("rr"),
  /** Computed by the shared engine and stored. Null when HR or SBP is missing. */
  shockIndex: numeric("shock_index", { precision: 4, scale: 2 }),
  suspectedInjuries: text("suspected_injuries").array().notNull().default([]),
  treatments: text("treatments").array().notNull().default([]),
  recHospitalId: uuid("rec_hospital_id").references(() => hospitalsMatrix.id),
  recRanking: jsonb("rec_ranking").$type<HospitalRanking>(),
  chosenHospitalId: uuid("chosen_hospital_id").references(() => hospitalsMatrix.id),
  overrideReason: text("override_reason"),
  etaMinutes: doublePrecision("eta_minutes"),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const handovers = pgTable("handovers", {
  id: uuid("id").primaryKey().defaultRandom(),
  assessmentId: uuid("assessment_id")
    .notNull()
    .references(() => medicAssessments.id),
  hospitalId: uuid("hospital_id")
    .notNull()
    .references(() => hospitalsMatrix.id),
  /** Frozen AT-MIST snapshot. */
  atmist: jsonb("atmist").$type<Record<string, unknown>>().notNull(),
  status: handoverStatus("status").notNull().default("pending"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  respondedBy: text("responded_by"),
  divertSpecialty: text("divert_specialty"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
