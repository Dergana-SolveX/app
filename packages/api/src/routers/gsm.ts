import { z } from "zod";

import { roleProcedure, router } from "../index";
import { findNearestTower } from "../services/cells";
import { receiveSms } from "../services/sms-flow";
import { handleUssd } from "../services/ussd";
import { listOutbox, listWireLog } from "../services/wire";

const adminOnly = roleProcedure("admin");

/** The emulated GSM network panel ("Réseau GSM (émulé)") in the demo console. */
export const gsmRouter = router({
  /** A phone "sends" an SMS to the SVX number. Handled exactly like an SMS from a real gateway. */
  inject: adminOnly
    // An SMS is at most 160 characters (concatenated messages a few times that); stay well inside that.
    .input(z.object({ from: z.string().min(1).max(32), body: z.string().max(1000) }))
    .mutation(({ ctx, input }) =>
      receiveSms(
        { db: ctx.db, events: ctx.events, transport: ctx.smsTransport },
        { ...input, emulated: true },
      ),
    ),

  /** Every SMS in both directions, newest first (the console wire log). */
  wire: adminOnly.query(({ ctx }) => listWireLog(ctx.db)),

  /** SMS the server sent (the "Boîte d'envoi GSM"). */
  outbox: adminOnly.query(({ ctx }) => listOutbox(ctx.db)),

  /**
   * The USSD operator emulator (PRD FR-S3-15). The presenter picks a point; the nearest REAL tower in `cell_towers`
   * is presented as the cell the call is on, and the request goes through the same logic as the operator webhook,
   * flagged emulated. `tower` says which tower was used (null when none is in reach).
   */
  ussd: adminOnly
    .input(
      z.object({
        sessionId: z.string().min(1).max(64),
        phoneNumber: z.string().min(1).max(32),
        text: z.string().max(200),
        near: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const found = input.near ? await findNearestTower(ctx.db, input.near.lat, input.near.lng) : null;
      const cellId = found ? `${found.mcc}-${found.mnc}-${found.lac}-${found.cid}` : undefined;
      const response = await handleUssd(
        { db: ctx.db, events: ctx.events },
        { sessionId: input.sessionId, serviceCode: "*140#", phoneNumber: input.phoneNumber, text: input.text, cellId },
        { emulated: true },
      );
      return {
        ...response,
        tower: found && cellId ? { cellId, lat: found.lat, lng: found.lng, rangeM: found.rangeM, distanceM: found.distanceM } : null,
      };
    }),
});
