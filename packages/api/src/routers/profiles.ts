import { incidentEvents, medicalProfiles, type Medication } from "@solvex-dergana/db/schema/index";
import { generateShortCode } from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { publicProcedure, roleProcedure, router } from "../index";

const authorizedAccess = roleProcedure("dispatcher", "medic", "hospital", "admin");

export const profilesRouter = router({
  register: publicProcedure
    .input(
      z.object({
        fullName: z.string().trim().min(2).max(100),
        sex: z.enum(["male", "female"]),
        phone: z.string().trim().min(5).max(30),
        bloodType: z
          .enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
          .nullable()
          .optional(),
        chronicConditions: z.array(z.string().trim().min(1)).default([]),
        birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        allergies: z.array(z.string().trim().min(1)).optional().default([]),
        consent: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      let shortCode = generateShortCode();

      // Check for collision and retry if needed
      for (let attempt = 0; attempt < 5; attempt++) {
        const [existing] = await ctx.db
          .select({ id: medicalProfiles.id })
          .from(medicalProfiles)
          .where(eq(medicalProfiles.shortCode, shortCode));
        if (!existing) break;
        shortCode = generateShortCode();
      }

      // Infer clinical medication classes from chronic conditions for dispatcher risk rules (FR-S3-07 / FR-S4-07)
      const medications: Medication[] = [];
      for (const cond of input.chronicConditions) {
        const c = cond.toLowerCase();
        if (c.includes("diab") || c.includes("insulin")) {
          medications.push({ name: cond, class: "insulin" });
        }
        if (c.includes("hypertens") || c.includes("bêtabloqu") || c.includes("betabloqu")) {
          medications.push({ name: cond, class: "beta_blocker" });
        }
        if (c.includes("anticoag") || c.includes("avk") || c.includes("fibrill")) {
          medications.push({ name: cond, class: "anticoagulant" });
        }
      }

      const [created] = await ctx.db
        .insert(medicalProfiles)
        .values({
          shortCode,
          fullName: input.fullName,
          birthDate: input.birthDate ?? "1990-01-01",
          sex: input.sex,
          bloodType: input.bloodType ?? null,
          chronicConditions: input.chronicConditions,
          allergies: input.allergies ?? [],
          medications,
          emergencyContact: input.phone,
          consentAt: now,
        })
        .returning({
          id: medicalProfiles.id,
          shortCode: medicalProfiles.shortCode,
          fullName: medicalProfiles.fullName,
          consentAt: medicalProfiles.consentAt,
        });

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Impossible d'enregistrer le profil médical",
        });
      }

      return created;
    }),

  byShortCode: authorizedAccess
    .input(
      z.object({
        shortCode: z.string().trim().length(8),
        incidentId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [profile] = await ctx.db
        .select()
        .from(medicalProfiles)
        .where(eq(medicalProfiles.shortCode, input.shortCode.toUpperCase()));

      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profil médical introuvable pour ce code",
        });
      }

      // Audit log: Law 18-07 requirement (FR-S3-07)
      await ctx.db.insert(incidentEvents).values({
        incidentId: input.incidentId ?? null,
        actorRole: ctx.appUser.role,
        actorId: ctx.appUser.id,
        type: "profile.accessed",
        payload: {
          profileId: profile.id,
          shortCode: profile.shortCode,
          incidentId: input.incidentId ?? null,
        },
      });

      return profile;
    }),
});
