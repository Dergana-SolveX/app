import type { Database } from "@solvex-dergana/db";
import { and, eq, inArray, lte } from "@solvex-dergana/db";
import { deviceCommands } from "@solvex-dergana/db/schema/comms";
import { vehicles } from "@solvex-dergana/db/schema/profiles";

/** Also run by the server timer, so offline devices time out without further requests. */
export async function expireDeviceCommands(db: Pick<Database, "update">, now = new Date(), deviceId?: string) {
  await db.update(deviceCommands).set({ status: "timeout" }).where(and(
    inArray(deviceCommands.status, ["queued", "delivered"]),
    lte(deviceCommands.issuedAt, new Date(now.getTime() - 60_000)),
    deviceId === undefined ? undefined : eq(deviceCommands.deviceId, deviceId),
  ));
}

export async function deliverDeviceCommands(db: Database, deviceId: string, now: Date) {
  const commands = await db.transaction(async (tx) => {
    await tx.select().from(vehicles).where(eq(vehicles.deviceId, deviceId)).for("update");
    await expireDeviceCommands(tx, now, deviceId);
    return tx.update(deviceCommands).set({ status: "delivered" }).where(and(
      eq(deviceCommands.deviceId, deviceId), inArray(deviceCommands.status, ["queued", "delivered"]),
    )).returning();
  });
  return commands.sort((a, b) => a.seq - b.seq).map(({ seq, cmd, args, hmac }) => ({ seq, cmd, args, hmac }));
}

export async function acknowledgeDeviceCommand(db: Database, deviceId: string,
  acknowledgement: { seq: number; result: Record<string, unknown>; emulated: boolean }, now: Date) {
  return db.transaction(async (tx) => {
    await tx.select().from(vehicles).where(eq(vehicles.deviceId, deviceId)).for("update");
    await expireDeviceCommands(tx, now, deviceId);
    const where = and(eq(deviceCommands.deviceId, deviceId), eq(deviceCommands.seq, acknowledgement.seq));
    const [command] = await tx.select().from(deviceCommands).where(where).for("update");
    if (!command || !["delivered", "acked", "timeout"].includes(command.status)) return false;
    if (!command.ackedAt) await tx.update(deviceCommands).set({ status: command.status === "timeout" ? "timeout" : "acked", ackedAt: now,
      result: { ...acknowledgement.result, emulated: acknowledgement.emulated } }).where(where);
    return true;
  });
}
