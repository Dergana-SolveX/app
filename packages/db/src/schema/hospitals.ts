import {
  boolean,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { hospitalTier, unitType } from "./enums";

export type SpecialtyStatus = Partial<Record<string, "accept" | "divert">>;

export const hospitalsMatrix = pgTable("hospitals_matrix", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  tier: hospitalTier("tier").notNull(),
  commune: text("commune").notNull(),
  wilaya: text("wilaya").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  phone: text("phone"),
  capNeurosurgery: boolean("cap_neurosurgery").notNull().default(false),
  capCtScanner: boolean("cap_ct_scanner").notNull().default(false),
  capBurnUnit: boolean("cap_burn_unit").notNull().default(false),
  capIcu: boolean("cap_icu").notNull().default(false),
  capTraumaSurgery: boolean("cap_trauma_surgery").notNull().default(false),
  capPediatric: boolean("cap_pediatric").notNull().default(false),
  capObstetrics: boolean("cap_obstetrics").notNull().default(false),
  capBloodBank: boolean("cap_blood_bank").notNull().default(false),
  capStabilizationOnly: boolean("cap_stabilization_only").notNull().default(false),
  status: jsonb("status").$type<SpecialtyStatus>().notNull().default({}),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
  statusUpdatedBy: text("status_updated_by"),
  /** False until a team member has checked coordinates and capabilities (see seed/SOURCES.md). */
  verified: boolean("verified").notNull().default(false),
});

export const ambulanceUnits = pgTable("ambulance_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  callSign: text("call_sign").notNull().unique(),
  type: unitType("type").notNull(),
  baseName: text("base_name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  available: boolean("available").notNull().default(true),
});
