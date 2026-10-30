import { deriveDeviceKey, deviceKeyCheck } from "@solvex-dergana/shared";
import { hashPassword } from "better-auth/crypto";
import { like, sql } from "drizzle-orm";

import type { Database } from "../index";
import {
  account,
  ambulanceUnits,
  appUsers,
  hospitalsMatrix,
  medicalProfiles,
  user,
  vehicles,
  zones,
} from "../schema";
import { buildDemoAccounts } from "./auth-accounts";
import { hospitals } from "./hospitals";
import { profiles, vehicleRows } from "./profiles";
import { units } from "./units";
import { userRows } from "./users";
import { zoneRows } from "./zones";
import { seedDemoHistory } from "./history";

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

export type SeedSecrets = {
  masterDeviceSecret: string;
  /** Shared password of every seeded demo login. */
  demoPassword: string;
};

const DEMO_AUTH_ID_PREFIX = "demo-";

/** Creates one Better Auth email/password login per `app_users` row and links it. */
async function seedDemoLogins(db: Database, demoPassword: string) {
  const accounts = buildDemoAccounts(userRows);
  const now = new Date();
  const passwordHash = await hashPassword(demoPassword);
  const authUserIdByAppUser = new Map(accounts.map((a) => [a.appUserId, a.authUserId]));
  await db
    .insert(user)
    .values(
      accounts.map((a) => ({
        id: a.authUserId,
        name: a.name,
        email: a.email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(account)
    .values(
      accounts.map((a) => ({
        id: `${DEMO_AUTH_ID_PREFIX}account-${a.appUserId}`,
        accountId: a.authUserId,
        providerId: "credential",
        userId: a.authUserId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(appUsers)
    .values(
      userRows.map((u) => ({
        ...u,
        authUserId: authUserIdByAppUser.get(u.id as string),
      })),
    )
    .onConflictDoUpdate({
      target: appUsers.id,
      set: { authUserId: sql`excluded.auth_user_id` },
    });
}

/** Idempotent: re-running leaves existing seeded rows untouched. */
export async function seed(db: Database, { masterDeviceSecret, demoPassword }: SeedSecrets) {
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
  await seedDemoLogins(db, demoPassword);
  await seedDemoHistory(db);
}

/**
 * Wipes all app data and the seeded demo logins (never `cell_towers`, never other auth users)
 * and restores the seed. Run this after changing the demo password.
 */
export async function resetApp(db: Database, secrets: SeedSecrets) {
  await db.execute(sql.raw(`TRUNCATE ${APP_TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  await db.delete(user).where(like(user.id, `${DEMO_AUTH_ID_PREFIX}%`));
  await seed(db, secrets);
}
