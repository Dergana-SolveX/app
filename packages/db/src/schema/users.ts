import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { ambulanceUnits, hospitalsMatrix } from "./hospitals";

/** Demo role-picker users (hardening is future work). Optionally linked to a Better Auth login. */
export const appUsers = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role", { enum: ["dispatcher", "medic", "hospital", "admin"] }).notNull(),
  unitId: uuid("unit_id").references(() => ambulanceUnits.id, { onDelete: "set null" }),
  hospitalId: uuid("hospital_id").references(() => hospitalsMatrix.id, { onDelete: "set null" }),
  authUserId: text("auth_user_id"),
});
