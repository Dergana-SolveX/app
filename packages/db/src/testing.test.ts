import { describe, expect, it } from "vitest";

import { hospitalsMatrix, smsLog } from "./schema";
import { createTestDb } from "./testing";

describe("createTestDb (in-process Postgres with the real migrations)", () => {
  it("starts empty and accepts inserts into the real schema", async () => {
    const db = await createTestDb();
    expect(await db.select().from(hospitalsMatrix)).toEqual([]);

    await db.insert(smsLog).values({
      direction: "in",
      msisdnHash: "abc",
      body: "SVX1#L:2",
      status: "received",
    });
    expect(await db.select().from(smsLog)).toHaveLength(1);
  });

  it("gives every call its own isolated database", async () => {
    const a = await createTestDb();
    const b = await createTestDb();
    await a.insert(smsLog).values({ direction: "in", msisdnHash: "x", body: "a", status: "received" });
    expect(await b.select().from(smsLog)).toEqual([]);
  });
});
