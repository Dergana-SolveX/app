import {
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type Medication = {
  name: string;
  class: "anticoagulant" | "beta_blocker" | "insulin" | "antihypertensive" | "other";
};

export const medicalProfiles = pgTable(
  "medical_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 8-char opaque code carried in SMS (never medical data). */
    shortCode: char("short_code", { length: 8 }).notNull().unique(),
    fullName: text("full_name").notNull(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    sex: text("sex", { enum: ["male", "female"] }).notNull(),
    bloodType: text("blood_type", {
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    }),
    chronicConditions: text("chronic_conditions").array().notNull().default([]),
    allergies: text("allergies").array().notNull().default([]),
    medications: jsonb("medications").$type<Medication[]>().notNull().default([]),
    pregnancyStatus: text("pregnancy_status", {
      enum: ["none", "t1", "t2", "t3"],
    })
      .notNull()
      .default("none"),
    emergencyContact: text("emergency_contact"),
    /** Required: Law 18-07 consent. */
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("medical_profiles_short_code_idx").on(t.shortCode)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull().unique(),
    deviceSecretHash: text("device_secret_hash").notNull(),
    /** Registered SIM, used to authenticate SMS from the chip. */
    simMsisdn: text("sim_msisdn"),
    firmwareVersion: text("firmware_version"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    batteryMv: integer("battery_mv"),
    lastTelemetry: jsonb("last_telemetry").$type<Record<string, unknown>>(),
    plate: text("plate"),
    makeModel: text("make_model"),
    fleetName: text("fleet_name"),
    ownerProfileId: uuid("owner_profile_id").references(() => medicalProfiles.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("vehicles_device_id_idx").on(t.deviceId)],
);
