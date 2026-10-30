import type { Database } from "@solvex-dergana/db";
import { deviceCommands } from "@solvex-dergana/db/schema/comms";
import { vehicles } from "@solvex-dergana/db/schema/profiles";
import { deriveDeviceKey, deviceKeyCheck, chipCommandName, chipEvent } from "@solvex-dergana/shared";
import { commandPayload, signDevicePayload, verifyDevicePayload } from "@solvex-dergana/shared/crypto/deviceCommand";
import { and, asc, eq, max, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { Hono } from "hono";

type Options = {
  db: Database;
  masterSecret: string;
  authenticate: (request: Request) => Promise<{ id: string; role: string } | null>;
  now?: () => Date;
};

/** Also run by the server timer, so offline devices time out without further requests. */
export async function expireDeviceCommands(db: Pick<Database, "update">, now = new Date(), deviceId?: string) {
  await db.update(deviceCommands).set({ status: "timeout" }).where(and(
    inArray(deviceCommands.status, ["queued", "delivered"]),
    lte(deviceCommands.issuedAt, new Date(now.getTime() - 60_000)),
    deviceId === undefined ? undefined : eq(deviceCommands.deviceId, deviceId),
  ));
}

export function createDevicesApp(options: Options) {
  const app = new Hono<{ Variables: { actorId: string } }>();
  app.use("/devices/:deviceId/commands", async (c, next) => {
    const actor = await options.authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Authentication required" }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admin required" }, 403);
    c.set("actorId", actor.id);
    await next();
  });
  const now = options.now ?? (() => new Date());
  app.post("/devices/:deviceId/commands", async (c) => {
    const input = z.object({ cmd: chipCommandName, args: z.array(z.string().max(128)).max(16).default([]) }).strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Invalid command" }, 400);
    const deviceId = c.req.param("deviceId");
    const command = await options.db.transaction(async (tx) => {
      // Lock the provisioned device, so concurrent issuers cannot allocate the same sequence.
      const [device] = await tx.select().from(vehicles).where(eq(vehicles.deviceId, deviceId)).for("update");
      if (!device) return null;
      const [last] = await tx.select({ seq: max(deviceCommands.seq) }).from(deviceCommands).where(eq(deviceCommands.deviceId, deviceId));
      const seq = (last?.seq ?? 0) + 1;
      const key = await deriveDeviceKey(options.masterSecret, deviceId);
      const hmac = await signDevicePayload(key, commandPayload(deviceId, { ...input.data, seq }));
      const [created] = await tx.insert(deviceCommands).values({ ...input.data, deviceId, seq, hmac,
        issuedBy: c.get("actorId"), issuedAt: now() }).returning();
      return created;
    });
    return command ? c.json(command, 201) : c.json({ error: "Unknown device" }, 404);
  });
  app.get("/devices/:deviceId/commands", async (c) => {
    await expireDeviceCommands(options.db, now(), c.req.param("deviceId"));
    const commands = await options.db.select().from(deviceCommands)
      .where(eq(deviceCommands.deviceId, c.req.param("deviceId"))).orderBy(asc(deviceCommands.seq));
    return c.json(commands);
  });
  app.use("/devices/:deviceId/*", async (c, next) => {
    // Commands use session authentication above; device endpoints use provisioned keys.
    if (c.req.path.endsWith("/commands")) return next();
    const deviceId = c.req.param("deviceId");
    const timestamp = c.req.header("X-SVX-Timestamp") ?? "";
    if (!/^\d{13}$/.test(timestamp) || Math.abs(now().getTime() - Number(timestamp)) > 300_000) {
      return c.json({ error: "Invalid device timestamp" }, 401);
    }
    const key = await deriveDeviceKey(options.masterSecret, deviceId);
    const [device] = await options.db.select().from(vehicles).where(eq(vehicles.deviceId, deviceId));
    if (!device || device.deviceSecretHash !== await deviceKeyCheck(key) ||
        !await verifyDevicePayload(key, `${timestamp}.${await c.req.text()}`, c.req.header("X-SVX-Signature") ?? "")) {
      return c.json({ error: "Invalid device signature" }, 401);
    }
    await next();
  });
  app.post("/devices/:deviceId/heartbeat", async (c) => {
    const deviceId = c.req.param("deviceId");
    const input = z.object({ deviceId: z.literal(deviceId), emulated: z.boolean().default(false) }).passthrough()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Invalid heartbeat" }, 400);
    const commands = await options.db.transaction(async (tx) => {
      await tx.select().from(vehicles).where(eq(vehicles.deviceId, deviceId)).for("update");
      await expireDeviceCommands(tx, now(), deviceId);
      await tx.update(vehicles).set({ lastHeartbeatAt: now(), lastTelemetry: input.data }).where(eq(vehicles.deviceId, deviceId));
      return tx.update(deviceCommands).set({ status: "delivered" }).where(and(
        eq(deviceCommands.deviceId, deviceId), inArray(deviceCommands.status, ["queued", "delivered"]),
      )).returning();
    });
    return c.json({ commands: commands.sort((a, b) => a.seq - b.seq).map(({ seq, cmd, args, hmac }) => ({ seq, cmd, args, hmac })) });
  });
  app.post("/devices/:deviceId/events", async (c) => {
    const deviceId = c.req.param("deviceId");
    const input = chipEvent.extend({ deviceId: z.literal(deviceId), type: z.literal("command_ack"),
      data: z.object({ seq: z.number().int().positive(), result: z.record(z.string(), z.unknown()) })
    }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Invalid command acknowledgement" }, 400);
    const accepted = await options.db.transaction(async (tx) => {
      await tx.select().from(vehicles).where(eq(vehicles.deviceId, deviceId)).for("update");
      await expireDeviceCommands(tx, now(), deviceId);
      const where = and(eq(deviceCommands.deviceId, deviceId), eq(deviceCommands.seq, input.data.data.seq));
      // Serialize the acknowledgement with the background timeout sweep as well.
      const [command] = await tx.select().from(deviceCommands).where(where).for("update");
      if (!command || !["delivered", "acked"].includes(command.status)) return false;
      if (command.status === "delivered") await tx.update(deviceCommands).set({ status: "acked", ackedAt: now(),
        result: { ...input.data.data.result, emulated: input.data.emulated } }).where(where);
      return true;
    });
    return accepted ? c.json({ accepted: true }) : c.json({ error: "Command is not awaiting acknowledgement" }, 409);
  });
  return app;
}
