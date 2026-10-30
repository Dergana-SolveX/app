import type { Database } from "@solvex-dergana/db";
import { hospitalsMatrix } from "@solvex-dergana/db/schema/index";
import { NEEDS, type Need } from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import type { AppUserContext } from "../context";
import type { EventBus } from "./events";

type Deps = { db: Database; events: EventBus };

export const NEED_TO_CAP: Record<Need, keyof typeof hospitalsMatrix.$inferSelect> = {
  neurosurgery: "capNeurosurgery",
  ct_scanner: "capCtScanner",
  burn_unit: "capBurnUnit",
  icu: "capIcu",
  trauma_surgery: "capTraumaSurgery",
  obstetrics: "capObstetrics",
  blood_bank: "capBloodBank",
  pediatric: "capPediatric",
};

export type HospitalDetails = {
  id: string;
  name: string;
  shortName: string;
  tier: "chu" | "ehs" | "eph" | "epsp_polyclinic";
  commune: string;
  wilaya: string;
  lat: number;
  lng: number;
  phone: string | null;
  capabilities: Record<Need, boolean>;
  status: Partial<Record<string, "accept" | "divert">>;
  statusUpdatedAt: Date | null;
  statusUpdatedBy: string | null;
  staleDivert: boolean;
};

/** Resolves and asserts access to the target hospital. */
export function assertHospitalAccess(appUser: AppUserContext, requestedHospitalId?: string): string {
  if (appUser.role === "admin") {
    if (!requestedHospitalId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "hospitalId is required for admin" });
    }
    return requestedHospitalId;
  }
  if (appUser.role === "hospital") {
    if (!appUser.hospitalId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No hospital assigned to this user" });
    }
    if (requestedHospitalId && requestedHospitalId !== appUser.hospitalId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Cannot access another hospital" });
    }
    return appUser.hospitalId;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Access restricted to hospital staff and admin" });
}

/** Fetches hospital metadata and capabilities, checking if divert status is older than 6 hours (PRD FR-S7-02). */
export async function getHospital(db: Database, hospitalId: string, now = new Date()): Promise<HospitalDetails> {
  const [row] = await db.select().from(hospitalsMatrix).where(eq(hospitalsMatrix.id, hospitalId));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Hôpital introuvable" });

  const status = (row.status ?? {}) as Partial<Record<string, "accept" | "divert">>;
  const hasDivert = Object.values(status).some((s) => s === "divert");
  const staleDivert = Boolean(
    hasDivert &&
      row.statusUpdatedAt &&
      now.getTime() - new Date(row.statusUpdatedAt).getTime() > 6 * 3600 * 1000,
  );

  const capabilities = {} as Record<Need, boolean>;
  for (const need of NEEDS) {
    const field = NEED_TO_CAP[need];
    capabilities[need] = Boolean(row[field]);
  }

  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    tier: row.tier,
    commune: row.commune,
    wilaya: row.wilaya,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    capabilities,
    status,
    statusUpdatedAt: row.statusUpdatedAt,
    statusUpdatedBy: row.statusUpdatedBy,
    staleDivert,
  };
}

/** Updates accept/divert for one specialty. Requires that the hospital actually has that capability. */
export async function updateHospitalStatus(
  { db, events }: Deps,
  appUser: AppUserContext,
  input: { hospitalId?: string; specialty: Need; status: "accept" | "divert" },
  now = new Date(),
) {
  const targetId = assertHospitalAccess(appUser, input.hospitalId);
  const [row] = await db.select().from(hospitalsMatrix).where(eq(hospitalsMatrix.id, targetId));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Hôpital introuvable" });

  const capField = NEED_TO_CAP[input.specialty];
  if (!row[capField]) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "L'établissement ne dispose pas de cette spécialité",
    });
  }

  const currentStatus = (row.status ?? {}) as Partial<Record<string, "accept" | "divert">>;
  const nextStatus = { ...currentStatus, [input.specialty]: input.status };

  const [updated] = await db
    .update(hospitalsMatrix)
    .set({
      status: nextStatus,
      statusUpdatedAt: now,
      statusUpdatedBy: appUser.id,
    })
    .where(eq(hospitalsMatrix.id, targetId))
    .returning();

  events.publish(
    {
      type: "hospital.status_updated",
      hospitalId: targetId,
      status: nextStatus as Record<string, "accept" | "divert">,
    },
    `hospital:${targetId}`,
  );

  return {
    hospitalId: targetId,
    status: updated!.status,
    statusUpdatedAt: updated!.statusUpdatedAt,
    statusUpdatedBy: updated!.statusUpdatedBy,
  };
}
