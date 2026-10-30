import { NEEDS } from "@solvex-dergana/shared";
import { TRPCError, tracked } from "@trpc/server";
import { z } from "zod";

import type { AppUserContext } from "../context";
import { roleProcedure, router } from "../index";
import type { Channel } from "../services/events";
import { listForAssessment, listIncoming, respondToHandover, sendHandover } from "../services/handovers";

const medicAccess = roleProcedure("medic", "admin");
const hospitalAccess = roleProcedure("hospital", "admin");

/** The hospital whose channel this login may hear: its own; the admin (demo operator) names one. */
function hospitalOf(appUser: AppUserContext, requested: string | undefined): string {
  if (appUser.role === "admin") {
    if (!requested) throw new TRPCError({ code: "BAD_REQUEST", message: "hospitalId is required for the admin" });
    return requested;
  }
  if (!appUser.hospitalId || (requested && requested !== appUser.hospitalId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This is not your hospital" });
  }
  return appUser.hospitalId;
}

function unitOf(appUser: AppUserContext, requested: string | undefined): string {
  if (appUser.role === "admin") {
    if (!requested) throw new TRPCError({ code: "BAD_REQUEST", message: "unitId is required for the admin" });
    return requested;
  }
  if (!appUser.unitId || (requested && requested !== appUser.unitId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This is not your ambulance" });
  }
  return appUser.unitId;
}

const subscribed = z.object({ lastEventId: z.string().nullish() });

export const handoversRouter = router({
  /** The medic confirms the destination: the hospital receives the AT-MIST. */
  send: medicAccess
    .input(z.object({ assessmentId: z.uuid() }))
    .mutation(({ ctx, input }) => sendHandover(ctx, ctx.appUser, input.assessmentId)),

  /** The hospital accepts, or diverts with the specialty it cannot offer. */
  respond: hospitalAccess
    .input(
      z.object({
        handoverId: z.uuid(),
        decision: z.enum(["accept", "divert"]),
        specialty: z.enum(NEEDS).optional(),
      }),
    )
    .mutation(({ ctx, input }) => respondToHandover(ctx, ctx.appUser, input)),

  /** The snapshot a hospital board starts from (and refetches on `ready` / `resync`). */
  incoming: hospitalAccess
    .input(z.object({ hospitalId: z.uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      listIncoming(ctx.db, ctx.appUser.role === "admin" ? (input?.hospitalId ?? null) : hospitalOf(ctx.appUser, input?.hospitalId)),
    ),

  /** The handovers of one bilan, for the tablet's En route screen. */
  forAssessment: medicAccess
    .input(z.object({ assessmentId: z.uuid() }))
    .query(({ ctx, input }) => listForAssessment(ctx.db, ctx.appUser, input.assessmentId)),

  /** Live stream for one hospital board over SSE (channel `hospital:{id}`). */
  onHospital: hospitalAccess
    .input(subscribed.extend({ hospitalId: z.uuid().optional() }))
    .subscription(({ ctx, input, signal }) => {
      // Checked here, before the stream starts, so a wrong hospital is refused at once.
      const channel: Channel = `hospital:${hospitalOf(ctx.appUser, input.hospitalId)}`;
      return (async function* () {
        for await (const { id, event } of ctx.events.stream(input.lastEventId ?? undefined, signal, channel)) {
          yield tracked(id, event);
        }
      })();
    }),

  /** Live stream for one ambulance tablet over SSE (channel `unit:{id}`). */
  onUnit: medicAccess
    .input(subscribed.extend({ unitId: z.uuid().optional() }))
    .subscription(({ ctx, input, signal }) => {
      const channel: Channel = `unit:${unitOf(ctx.appUser, input.unitId)}`;
      return (async function* () {
        for await (const { id, event } of ctx.events.stream(input.lastEventId ?? undefined, signal, channel)) {
          yield tracked(id, event);
        }
      })();
    }),
});
