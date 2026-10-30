import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { masterIncidents } from "./incidents";

/** What the ingest pipeline learned from an SMS (shown in the console wire log). */
export type SmsResult = {
  recognized: boolean;
  crcValid: boolean;
  parseErrors: string[];
  duplicate?: boolean;
};

export const smsLog = pgTable(
  "sms_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    msisdnHash: text("msisdn_hash").notNull(),
    body: text("body").notNull(),
    modemRef: text("modem_ref"),
    status: text("status", {
      enum: ["received", "queued", "sent", "delivered", "failed"],
    }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    /** True for SMS that went through the emulated GSM network (honesty rule). */
    emulated: boolean("emulated").notNull().default(false),
    /** The incident this SMS created or was merged into (inbound), or is about (outbound ack). */
    incidentId: uuid("incident_id").references(() => masterIncidents.id),
    result: jsonb("result").$type<SmsResult>(),
  },
  (t) => [index("sms_log_at_idx").on(t.at)],
);

/** Signed commands from the IoT Showcase to the chip (PLAN.md S8.6), audited. */
export const deviceCommands = pgTable(
  "device_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull(),
    /** Replay protection: strictly increasing per device. */
    seq: integer("seq").notNull(),
    cmd: text("cmd", { enum: ["inject_trace", "force_channel", "arm", "selftest"] }).notNull(),
    args: jsonb("args").$type<string[]>().notNull().default([]),
    hmac: text("hmac").notNull(),
    status: text("status", { enum: ["queued", "delivered", "acked", "timeout"] })
      .notNull()
      .default("queued"),
    issuedBy: text("issued_by"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
  },
  (t) => [unique("device_commands_device_seq_unique").on(t.deviceId, t.seq)],
);
