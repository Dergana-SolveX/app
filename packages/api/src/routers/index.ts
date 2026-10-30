import { protectedProcedure, publicProcedure, router } from "../index";
import { alertsRouter } from "./alerts";
import { assessmentsRouter } from "./assessments";
import { cellsRouter } from "./cells";
import { chipRouter } from "./chip";
import { dispatchRouter } from "./dispatch";
import { gsmRouter } from "./gsm";
import { handoversRouter } from "./handovers";
import { hospitalsRouter } from "./hospitals";
import { incidentsRouter } from "./incidents";
import { statsRouter } from "./stats";

export const appRouter = router({
  alerts: alertsRouter,
  assessments: assessmentsRouter,
  cells: cellsRouter,
  chip: chipRouter,
  dispatch: dispatchRouter,
  gsm: gsmRouter,
  handovers: handoversRouter,
  hospitals: hospitalsRouter,
  incidents: incidentsRouter,
  stats: statsRouter,
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
