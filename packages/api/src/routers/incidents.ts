import { TRPCError, tracked } from "@trpc/server";
import { z } from "zod";

import { roleProcedure, router } from "../index";
import { getEvaluation, listIncidents, notifyAuthority } from "../services/incidents";

const dispatcherAccess = roleProcedure("dispatcher", "admin");

export const incidentsRouter = router({
  merge: dispatcherAccess
    .input(
      z.object({
        sourceId: z.uuid(),
        targetId: z.uuid(),
        sourceVersion: z.number().int().positive(),
        targetVersion: z.number().int().positive(),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await mergeIncidents(ctx.db, ctx.appUser, input);
      ctx.events.publish({ type: "incident.updated", incident: result.source });
      ctx.events.publish({ type: "incident.updated", incident: result.target });
      return result.target;
    }),
  split: dispatcherAccess
    .input(
      z.object({
        id: z.uuid(),
        version: z.number().int().positive(),
        alertIds: z.array(z.uuid()).min(1).max(200),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const incident = await splitIncident(ctx.db, ctx.appUser, input);
      const source = await getIncident(ctx.db, input.id);
      if (source)
        ctx.events.publish({ type: "incident.updated", incident: source });
      ctx.events.publish({ type: "incident.created", incident });
      return incident;
    }),
  markFalseAlarm: dispatcherAccess
    .input(
      z.object({
        id: z.uuid(),
        version: z.number().int().positive(),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const incident = await markFalseAlarm(ctx.db, ctx.appUser, input);
      ctx.events.publish({ type: "incident.updated", incident });
      return incident;
    }),
  mapLayers: dispatcherAccess.query(({ ctx }) => getMapLayers(ctx.db)),
  profiles: dispatcherAccess
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) =>
      getIncidentProfiles(ctx.db, input.id, ctx.appUser),
    ),
  byId: dispatcherAccess
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const incident = await getIncident(ctx.db, input.id);
      if (!incident)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Incident introuvable",
        });
      return incident;
    }),

  /** The snapshot the dispatcher queue starts from (and refetches on `ready` / `resync`). */
  list: dispatcherAccess.query(({ ctx }) => listIncidents(ctx.db)),

  /** One incident with its recommendation and the reasons behind it: the evaluation card. Null if unknown. */
  byId: dispatcherAccess
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => getEvaluation(ctx.db, input.id)),

  /** Notifies the relevant authority (Police / Gendarmerie) by SMS summary and logs it (FR-S5-05). */
  notifyAuthority: dispatcherAccess
    .input(z.object({ incidentId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      notifyAuthority(ctx.db, ctx.smsTransport, ctx.events, ctx.appUser!, input.incidentId),
    ),

  /** Live stream of dispatcher events over SSE. `lastEventId` is filled in by the client on reconnect. */
  onChange: dispatcherAccess
    .input(z.object({ lastEventId: z.string().nullish() }))
    .subscription(async function* ({ ctx, input, signal }) {
      for await (const { id, event } of ctx.events.stream(
        input.lastEventId ?? undefined,
        signal,
      )) {
        yield tracked(id, event);
      }
    }),
});
