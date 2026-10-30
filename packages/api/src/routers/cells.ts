import { getOperatorInfo } from "@solvex-dergana/shared";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import { findNearestTower, listSurveyTowers, recordCellSurvey, resolveCell } from "../services/cells";

export const cellsRouter = router({
  /**
   * Logs a field survey point (Cell-ID, GPS) from the mobile app (PRD FR-S4-08).
   * Persists into `cell_towers` with `source = 'survey'`.
   */
  logSurvey: publicProcedure
    .input(
      z.object({
        mcc: z.number().int().min(1).max(999),
        mnc: z.number().int().min(1).max(999),
        lac: z.number().int().min(1).max(65535),
        cid: z.number().int().min(1).max(268435455),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        rangeM: z.number().min(1).max(50_000).optional(),
        signalDbm: z.number().nullish(),
        recordedAt: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await recordCellSurvey(ctx.db, input);
      return {
        ...result,
        operator: getOperatorInfo(result.tower.mcc, result.tower.mnc),
      };
    }),

  /**
   * Lists the most recently surveyed cell towers.
   */
  listSurveys: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const towers = await listSurveyTowers(ctx.db, input?.limit ?? 50);
      return towers.map((tower) => ({
        ...tower,
        operator: getOperatorInfo(tower.mcc, tower.mnc),
      }));
    }),

  /**
   * Resolves a tower by its cellular coordinates (MCC, MNC, LAC, CID).
   */
  resolve: publicProcedure
    .input(
      z.object({
        mcc: z.number().int(),
        mnc: z.number().int(),
        lac: z.number().int(),
        cid: z.number().int(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tower = await resolveCell(ctx.db, input);
      if (!tower) return null;
      return {
        ...tower,
        operator: getOperatorInfo(input.mcc, input.mnc),
      };
    }),

  /**
   * Finds the nearest tower to a given geographic point.
   */
  nearest: publicProcedure
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        maxM: z.number().min(1).max(50_000).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return findNearestTower(ctx.db, input.lat, input.lng, input.maxM ?? 5000);
    }),
});
