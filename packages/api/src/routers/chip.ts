import { chipState } from "@solvex-dergana/shared";
import { z } from "zod";

import { roleProcedure, router } from "../index";
import { heartbeatFromChip, transmitFromChip } from "../services/chip";

/** The presenter: only the admin (demo operator) drives the simulated chip. */
const presenterOnly = roleProcedure("admin");

/** The seeded demo chip. */
const DEMO_DEVICE_ID = "SVX-CHIP-001";

const packet = z.object({
  cause: z.enum(["impact", "rollover", "fire"]),
  impacts: z.number().int().min(0).max(100),
  peakG: z.number().min(0).max(1000),
  deltaVKmh: z.number().min(0).max(500),
  saturated: z.boolean(),
  rollover: z.boolean(),
  rolloverDeg: z.number().min(0).max(360).nullable(),
  fire: z.boolean(),
});

export const chipRouter = router({
  /** The simulated chip sends its packet: by the web (signed device event) or by SMS (zone blanche). */
  transmit: presenterOnly
    .input(
      z.object({
        deviceId: z.string().min(1).max(64).default(DEMO_DEVICE_ID),
        channel: z.enum(["http", "sms"]),
        packet,
        position: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
        /** When it happened, as epoch milliseconds (the page's clock has fractions): kept through every retry. */
        eventAt: z.number().finite().positive(),
      }),
    )
    .mutation(({ ctx, input }) => transmitFromChip(ctx, input)),

  /** The simulated chip says it is alive. */
  heartbeat: presenterOnly
    .input(
      z.object({
        deviceId: z.string().min(1).max(64).default(DEMO_DEVICE_ID),
        state: chipState,
        batteryPct: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(({ ctx, input }) => heartbeatFromChip(ctx, input)),
});
