import { z } from "zod";

export const chipState = z.enum([
  "BOOT",
  "IDLE",
  "ARMED",
  "IMPACT",
  "CONFIRM",
  "SEND",
  "AWAIT_ACK",
  "DONE",
]);
export type ChipState = z.infer<typeof chipState>;

/** Sensor/block that produced data in the last tick (drives the animated block diagram). */
export const chipBlock = z.enum(["adxl375", "mpu6050", "gnss", "smoke", "flame", "esp32", "sim7600", "battery"]);

/** `@T{json}` serial line, or the heartbeat/telemetry stream over 4G (reduced rate). */
export const chipTelemetry = z.object({
  deviceId: z.string(),
  t: z.number(),
  g: z.number(),
  roll: z.number(),
  pitch: z.number(),
  state: chipState,
  gps: z.object({ fix: z.boolean(), sats: z.number(), lat: z.number().nullable(), lng: z.number().nullable() }),
  signalDbm: z.number().nullable(),
  batteryPct: z.number(),
  vehicle12vOk: z.boolean(),
  activeBlock: chipBlock.nullable(),
  demoArm: z.boolean(),
});
export type ChipTelemetry = z.infer<typeof chipTelemetry>;

/** `@E{json}` serial line, or posted to /devices/:deviceId/events. */
export const chipEvent = z.object({
  deviceId: z.string(),
  t: z.number(),
  type: z.enum([
    "state_change",
    "at_command",
    "impact_detected",
    "impact_rejected",
    "cancel_pressed",
    "sms_sent",
    "http_sent",
    "ack_received",
    "command_ack",
    "selftest",
  ]),
  data: z.record(z.string(), z.unknown()).default({}),
  /** Set when the event came from an injected recorded trace or the demo-arm switch. */
  traceInjected: z.boolean().default(false),
  emulated: z.boolean().default(false),
});
export type ChipEvent = z.infer<typeof chipEvent>;

export const chipCommandName = z.enum(["inject_trace", "force_channel", "arm", "selftest"]);

/** Signed, numbered command: `SVXCMD <seq> <cmd> <args> <hmac>` over USB, or queued via /devices/:id/commands. */
export const chipCommand = z.object({
  seq: z.number().int().nonnegative(),
  cmd: chipCommandName,
  args: z.array(z.string()).default([]),
  hmac: z.string(),
});
export type ChipCommand = z.infer<typeof chipCommand>;

export const chipTraceName = z.enum(["frontal_40", "rollover", "fire_parked", "pothole"]);
