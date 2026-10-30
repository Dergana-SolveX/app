import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { roleProcedure, router } from "../index";
import { getDispatcherStats, getHospitalStats } from "../services/stats";

export const statsRouter = router({
  dispatcher: roleProcedure("dispatcher", "admin")
    .input(
      z
        .object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          includeEmulated: z.boolean().default(true),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return getDispatcherStats(ctx.db, input ?? {});
    }),

  hospital: roleProcedure("hospital", "dispatcher", "admin")
    .input(
      z
        .object({
          hospitalId: z.string().uuid().optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          includeEmulated: z.boolean().default(true),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      let targetHospitalId = input?.hospitalId;

      if (role === "hospital") {
        if (!ctx.appUser.hospitalId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Aucun hôpital associé à ce compte.",
          });
        }
        if (targetHospitalId && targetHospitalId !== ctx.appUser.hospitalId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Un hôpital ne peut consulter que ses propres statistiques.",
          });
        }
        targetHospitalId = ctx.appUser.hospitalId;
      }

      if (!targetHospitalId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Identifiant hospitalier requis.",
        });
      }

      return getHospitalStats(ctx.db, {
        hospitalId: targetHospitalId,
        from: input?.from,
        to: input?.to,
        includeEmulated: input?.includeEmulated,
      });
    }),
});
