import { z } from "zod";

import { roleProcedure, router } from "../index";
import { getMission, orientationData, listOpenIncidents, saveAssessment } from "../services/assessments";

const medicAccess = roleProcedure("medic", "admin");

const vittelItem = z.object({
  value: z.union([z.boolean(), z.number(), z.string()]),
  source: z.enum(["iot", "app", "medic"]),
});
const vittelEntries = z
  .object({
    l1: z.record(z.string(), vittelItem),
    l2: z.record(z.string(), vittelItem),
    l3: z.record(z.string(), vittelItem),
    l4: z.record(z.string(), vittelItem),
    l5: z.record(z.string(), vittelItem),
  })
  .partial();

const tag = z.string().min(1).max(60);

export const assessmentsRouter = router({
  /** Incidents still in progress. A stop-gap until missions are dispatched to a unit (#7). */
  openIncidents: medicAccess.query(({ ctx }) => listOpenIncidents(ctx.db)),

  /** Every hospital with its capabilities and status, plus the city zones: what the tablet ranks with, and caches for offline use. */
  orientationData: medicAccess.query(({ ctx }) => orientationData(ctx.db)),

  /** One incident for the bilan screen: sensor prefill, linked profiles, this ambulance's recorded victims. */
  mission: medicAccess
    .input(z.object({ incidentId: z.uuid() }))
    .query(({ ctx, input }) => getMission(ctx.db, ctx.appUser, input.incidentId)),

  /** Saves one victim's bilan. The Shock Index and the Vittel verdict are recomputed here from the raw measures. */
  save: medicAccess
    .input(
      z.object({
        incidentId: z.uuid(),
        unitId: z.uuid().optional(),
        victimIndex: z.number().int().min(1).max(20).default(1),
        profileId: z.uuid().optional(),
        estAge: z.number().int().min(0).max(120).optional(),
        sex: z.enum(["male", "female", "unknown"]).optional(),
        vittel: vittelEntries.optional(),
        gcs: z.number().int().min(3).max(15).optional(),
        hr: z.number().int().min(0).max(300).optional(),
        sbp: z.number().int().min(0).max(350).optional(),
        dbp: z.number().int().min(0).max(250).optional(),
        spo2: z.number().int().min(0).max(100).optional(),
        rr: z.number().int().min(0).max(80).optional(),
        suspectedInjuries: z.array(tag).max(40).default([]),
        treatments: z.array(tag).max(40).default([]),
        chosenHospitalId: z.uuid().optional(),
        overrideReason: z.string().max(300).optional(),
      }),
    )
    .mutation(({ ctx, input }) => saveAssessment(ctx.db, ctx.appUser, input)),
});
