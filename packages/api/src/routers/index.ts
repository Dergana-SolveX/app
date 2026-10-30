import { protectedProcedure, publicProcedure, router } from "../index";
import { assessmentsRouter } from "./assessments";
import { dispatchRouter } from "./dispatch";
import { gsmRouter } from "./gsm";
import { incidentsRouter } from "./incidents";

export const appRouter = router({
  assessments: assessmentsRouter,
  dispatch: dispatchRouter,
  gsm: gsmRouter,
  incidents: incidentsRouter,
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  /** The caller's demo role record, or null for a login that has none. */
  me: protectedProcedure.query(({ ctx }) => ctx.appUser),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
});
export type AppRouter = typeof appRouter;
