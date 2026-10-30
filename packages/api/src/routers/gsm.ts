import { z } from "zod";

import { roleProcedure, router } from "../index";
import { receiveSms } from "../services/sms-flow";
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
});
