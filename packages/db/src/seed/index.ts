import { deriveDeviceKey, deviceKeyCheck } from "@solvex-dergana/shared";
import { sql } from "drizzle-orm";

import type { Database } from "../index";
import {
  ambulanceUnits,
  appUsers,
  hospitalsMatrix,
  medicalProfiles,
  vehicles,
  zones,
} from "../schema";
import { hospitals } from "./hospitals";
import { profiles, vehicleRows } from "./profiles";
import { units } from "./units";
import { userRows } from "./users";
import { zoneRows } from "./zones";

/** Tables owned by the app (everything except Better Auth). Truncated by `resetApp`. */
const APP_TABLES = [
  "handovers",
  "medic_assessments",
  "dispatches",
  "incident_events",
  "raw_alerts",
  "master_incidents",
  "device_commands",
  "sms_log",
  "app_users",
  "vehicles",
  "medical_profiles",
  "ambulance_units",
  "hospitals_matrix",
  "zones",
];

/** Idempotent: re-running leaves existing seeded rows untouched. */
export async function seed(db: Database, masterDeviceSecret: string) {
  await db.insert(hospitalsMatrix).values(hospitals).onConflictDoNothing();
  await db.insert(ambulanceUnits).values(units).onConflictDoNothing();
  await db.insert(medicalProfiles).values(profiles).onConflictDoNothing();
  const vehicleValues = await Promise.all(
    vehicleRows.map(async (v) => ({
      ...v,
      deviceSecretHash: await deviceKeyCheck(await deriveDeviceKey(masterDeviceSecret, v.deviceId)),
    })),
  );
  await db.insert(vehicles).values(vehicleValues).onConflictDoNothing();
  await db.insert(zones).values(zoneRows).onConflictDoNothing();
  await db.insert(appUsers).values(userRows).onConflictDoNothing();
}

/** Wipes all app data (never `cell_towers`, never auth tables) and restores the seed. */
export async function resetApp(db: Database, masterDeviceSecret: string) {
  await db.execute(sql.raw(`TRUNCATE ${APP_TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  await seed(db, masterDeviceSecret);
}
