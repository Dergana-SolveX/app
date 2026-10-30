import type { EventBus } from "@solvex-dergana/api/services/events";
import { createDeviceApp } from "./device-routes";
import { expireDeviceCommands } from "./device-command-queue";
export { expireDeviceCommands } from "./device-command-queue";
import type { Database } from "@solvex-dergana/db";
import { deviceCommands } from "@solvex-dergana/db/schema/comms";
import { vehicles } from "@solvex-dergana/db/schema/profiles";
import { deriveDeviceKey, chipCommandInput, signDevicePayload } from "@solvex-dergana/shared";
import { commandPayload } from "@solvex-dergana/shared/crypto/deviceCommand";
import { asc, eq, max } from "@solvex-dergana/db";
import { Hono } from "hono";

type Options = {
  db: Database;
  events: EventBus;
  masterSecret: string;
  authenticate: (request: Request) => Promise<{ id: string; role: string } | null>;
  now?: () => Date;
};

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
    const input = chipCommandInput
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
  app.route("/", createDeviceApp({ db: options.db, masterDeviceSecret: options.masterSecret, events: options.events, now }));
  return app;
}
