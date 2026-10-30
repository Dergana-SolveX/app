import { masterIncidents, medicalProfiles, rawAlerts } from "@solvex-dergana/db/schema/index";
import { geohashEncode } from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import { placeAlert } from "../services/clustering";
import { retriageIncident } from "../services/triage";

export const alertsRouter = router({
  submitOnline: publicProcedure
    .input(
      z.object({
        idempotencyKey: z.string().trim().min(1).max(128),
        source: z.enum(["app_witness", "app_auto"]).default("app_witness"),
        profileCode: z.string().trim().length(8).nullable().optional(),
        victims: z.number().int().min(1).max(50),
        conscious: z.number().int().min(0).max(2).nullable().default(null),
        fire: z.boolean().default(false),
        trapped: z.boolean().default(false),
        bleeding: z.boolean().default(false),
        lat: z.number().min(-90).max(90).nullable().default(null),
        lng: z.number().min(-180).max(180).nullable().default(null),
        accuracyM: z.number().positive().nullable().default(null),
        commune: z.string().trim().max(100).nullable().default(null),
        pkMarker: z.string().trim().max(100).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const dedupeKey = `${input.source}:${input.idempotencyKey}`;
      const now = new Date();

      // Check if this report was already ingested
      const [existing] = await ctx.db
        .select({ id: rawAlerts.id, incidentId: rawAlerts.incidentId })
        .from(rawAlerts)
        .where(eq(rawAlerts.dedupeKey, dedupeKey));

      if (existing && existing.incidentId) {
        return {
          alertId: existing.id,
          incidentId: existing.incidentId,
          duplicate: true,
          merged: false,
        };
      }

      // Medical profile lookup if short code provided (FR-S4-07 / FR-S3-07)
      const [profile] = input.profileCode
        ? await ctx.db
            .select({ id: medicalProfiles.id })
            .from(medicalProfiles)
            .where(eq(medicalProfiles.shortCode, input.profileCode.toUpperCase()))
        : [];

      const hasCoords = input.lat !== null && input.lng !== null;
      const geohash = hasCoords ? geohashEncode(input.lat!, input.lng!, 8) : null;
      const position = hasCoords
        ? { lat: input.lat!, lng: input.lng!, accuracyM: input.accuracyM ?? 10 }
        : null;

      const alertRow = {
        source: input.source,
        channel: "internet" as const,
        receivedAt: now,
        eventAt: now,
        profileId: profile?.id ?? null,
        lat: input.lat,
        lng: input.lng,
        accuracyM: input.accuracyM ? Math.round(input.accuracyM) : null,
        geohash,
        victims: input.victims,
        conscious: input.conscious,
        fire: input.fire,
        trapped: input.trapped,
        bleeding: input.bleeding,
        dedupeKey,
        emulated: false,
        authenticated: null,
        rawPayload: JSON.stringify({
          source: input.source,
          profileCode: input.profileCode,
          victims: input.victims,
          conscious: input.conscious,
          fire: input.fire,
          trapped: input.trapped,
          bleeding: input.bleeding,
          commune: input.commune,
          pkMarker: input.pkMarker,
        }),
      };

      const placement = await placeAlert(ctx.db, {
        alertRow,
        position,
        eventAt: now,
      });

      if (placement.kind === "duplicate") {
        const [stored] = await ctx.db
          .select({ id: rawAlerts.id, incidentId: rawAlerts.incidentId })
          .from(rawAlerts)
          .where(eq(rawAlerts.dedupeKey, dedupeKey));
        return {
          alertId: stored!.id,
          incidentId: stored!.incidentId!,
          duplicate: true,
          merged: false,
        };
      }

      // If manual location info was provided, save to master incident
      if (input.commune || input.pkMarker) {
        await ctx.db
          .update(masterIncidents)
          .set({
            ...(input.commune ? { commune: input.commune } : {}),
            ...(input.pkMarker ? { pkMarker: input.pkMarker } : {}),
          })
          .where(eq(masterIncidents.id, placement.incident.id));
      }

      // Re-triage and publish live dispatcher event
      const triaged = await retriageIncident(
        { db: ctx.db, events: ctx.events },
        placement.incident.id,
        { announce: false },
      ).catch(() => null);

      const incident = triaged ?? placement.incident;
      ctx.events.publish({
        type: placement.kind === "created" ? "incident.created" : "incident.updated",
        incident,
      });

      const [stored] = await ctx.db
        .select({ id: rawAlerts.id })
        .from(rawAlerts)
        .where(eq(rawAlerts.dedupeKey, dedupeKey));

      return {
        alertId: stored!.id,
        incidentId: placement.incident.id,
        duplicate: false,
        merged: placement.kind === "merged",
      };
    }),
});
