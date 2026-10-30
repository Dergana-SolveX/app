import { createTestDb } from "@solvex-dergana/db/testing";
import { describe, expect, it } from "vitest";

import { listOutbox } from "../services/wire";
import { createTransport } from "./transport";

describe("createTransport", () => {
  it("selects the emulator, whose sent SMS show up in the outbox flagged as emulated", async () => {
    const db = await createTestDb();
    const transport = createTransport("emulator", { db });
    expect(transport.kind).toBe("emulator");

    await transport.send("+213550000001", "SVXACK#3F9A12BC");

    const outbox = await listOutbox(db);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      direction: "out",
      body: "SVXACK#3F9A12BC",
      emulated: true,
      status: "sent",
    });
    // Only a hash of the recipient is kept.
    expect(JSON.stringify(outbox[0])).not.toContain("+213550000001");
  });

  it("does not list inbound SMS in the outbox", async () => {
    const db = await createTestDb();
    await createTransport("emulator", { db }).send("+213550000001", "hello");
    expect((await listOutbox(db)).every((m) => m.direction === "out")).toBe(true);
  });

  it("refuses transports that are not built yet, and unknown names, with a clear error", async () => {
    const db = await createTestDb();
    expect(() => createTransport("android", { db })).toThrow(/not implemented/i);
    expect(() => createTransport("modem", { db })).toThrow(/not implemented/i);
    expect(() => createTransport("fax", { db })).toThrow(/unknown sms transport/i);
  });
});
