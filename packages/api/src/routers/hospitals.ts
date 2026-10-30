import { NEEDS } from "@solvex-dergana/shared";
import { z } from "zod";

import { protectedProcedure, roleProcedure, router } from "../index";
import { getHospital, updateHospitalStatus } from "../services/hospitals";

const hospitalOrAdminAccess = roleProcedure("hospital", "admin");

export const hospitalsRouter = router({
  /** Gets hospital metadata, capabilities, status, and whether divert is stale (> 6h). */
  byId: protectedProcedure
    .input(z.object({ hospitalId: z.uuid() }))
    .query(({ ctx, input }) => getHospital(ctx.db, input.hospitalId)),

  /** Toggles accept/divert for one specialty. Requires hospital staff or admin. */
  updateStatus: hospitalOrAdminAccess
    .input(
      z.object({
        hospitalId: z.uuid().optional(),
        specialty: z.enum(NEEDS),
        status: z.enum(["accept", "divert"]),
      }),
    )
    .mutation(({ ctx, input }) => updateHospitalStatus(ctx, ctx.appUser, input)),
});
