import { tracked } from "@trpc/server";
import { z } from "zod";

import { roleProcedure, router } from "../index";
import { getEvaluation, listIncidents } from "../services/incidents";

const dispatcherAccess = roleProcedure("dispatcher", "admin");

export const incidentsRouter = router({
  /** The snapshot the dispatcher queue starts from (and refetches on `ready` / `resync`). */
  list: dispatcherAccess.query(({ ctx }) => listIncidents(ctx.db)),

  /** One incident with its recommendation and the reasons behind it: the evaluation card. Null if unknown. */
  byId: dispatcherAccess
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => getEvaluation(ctx.db, input.id)),

  /** Live stream of dispatcher events over SSE. `lastEventId` is filled in by the client on reconnect. */
  onChange: dispatcherAccess
    .input(z.object({ lastEventId: z.string().nullish() }))
    .subscription(async function* ({ ctx, input, signal }) {
      for await (const { id, event } of ctx.events.stream(input.lastEventId ?? undefined, signal)) {
        yield tracked(id, event);
      }
    }),
});
