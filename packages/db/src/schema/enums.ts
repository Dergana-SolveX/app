import { pgEnum } from "drizzle-orm/pg-core";

export const alertSource = pgEnum("alert_source", ["iot", "app_auto", "app_witness", "ussd"]);
export const alertChannel = pgEnum("alert_channel", ["internet", "sms", "ussd"]);
export const severity = pgEnum("severity", ["red", "yellow", "green", "unknown"]);
export const incidentStatus = pgEnum("incident_status", [
  "open",
  "dispatched",
  "on_scene",
  "transporting",
  "handed_over",
  "closed",
  "false_alarm",
]);
export const unitType = pgEnum("unit_type", [
  "vsav_standard",
  "ambulance_medicalisee",
  "desincarceration",
]);
export const authority = pgEnum("authority", ["surete_nationale", "gendarmerie_nationale"]);
export const hospitalTier = pgEnum("hospital_tier", ["chu", "ehs", "eph", "epsp_polyclinic"]);
export const handoverStatus = pgEnum("handover_status", ["pending", "accepted", "diverted"]);
