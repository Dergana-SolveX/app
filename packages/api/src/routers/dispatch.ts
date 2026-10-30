import { tracked } from "@trpc/server";
import { z } from "zod";

import { roleProcedure, router } from "../index";
import {
  approveDispatch,
  assertOwnUnit,
  getCurrentMission,
  getDispatchRecommendation,
  markArrived,
} from "../services/dispatch";

const dispatcherAccess = roleProcedure("dispatcher", "admin");
const medicAccess = roleProcedure("medic", "admin");

/** The dispatcher approves or modifies the recommended dispatch; the assigned ambulance receives it live. */
export const dispatchRouter = router({
  /** The dispatch form: recommended units, the available units nearest first, and the prefilled choice. */
  recommendation: dispatcherAccess
    .input(z.object({ incidentId: z.uuid() }))
    .query(({ ctx, input }) => getDispatchRecommendation(ctx.db, input.incidentId)),

  /** One decision per incident: approve the recommendation, or modify it with a reason. A stale form or a second approver is refused. */
  approve: dispatcherAccess
    .input(
      z.object({
        incidentId: z.uuid(),
        expectedVersion: z.number().int(),
        unitIds: z.array(z.uuid()).min(1).max(10).refine((ids) => new Set(ids).size === ids.length, "Unités en double"),
        reason: z.string().max(500).optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => approveDispatch({ db: ctx.db, events: ctx.events }, ctx.appUser, input)),

  /** Live channel of one ambulance (`unit:{id}`): its assignments. A medic hears their own unit only; the admin any. */
  onUnit: medicAccess
    .input(z.object({ unitId: z.uuid(), lastEventId: z.string().nullish() }))
    .subscription(async function* ({ ctx, input, signal }) {
      assertOwnUnit(ctx.appUser, input.unitId);
      for await (const { id, event } of ctx.events.streamUnit(input.unitId, input.lastEventId ?? undefined, signal)) {
        yield tracked(id, event);
      }
    }),

  /** The mission this ambulance is on, or null. */
  currentMission: medicAccess
    .input(z.object({ unitId: z.uuid() }))
    .query(({ ctx, input }) => getCurrentMission(ctx.db, ctx.appUser, input.unitId)),

  /** « Arrivé sur les lieux »: puts the incident on scene. */
  arrive: medicAccess
    .input(z.object({ incidentId: z.uuid(), unitId: z.uuid() }))
    .mutation(({ ctx, input }) => markArrived({ db: ctx.db, events: ctx.events }, ctx.appUser, input)),
});
