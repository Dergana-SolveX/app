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
    expect(() => createTransport("fax", { db })).toThrow(/unknown sms transport/i);
  });
});

const SECRET = "test-gateway-secret-0123456789ab";

/** The SMS gateway, as seen from the server: records what it is sent and answers as told. */
function fakeGateway(answer: () => Response | Promise<Response>) {
  const calls: { url: string; authorization: string | null; body: unknown }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return answer();
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

describe("createTransport: modem (through apps/gateway)", () => {
  it("needs to know where the gateway is", async () => {
    const db = await createTestDb();
    expect(() => createTransport("modem", { db })).toThrow(/GATEWAY_URL/);
  });

  it("sends through the gateway with the shared secret, and logs a real (not emulated) SMS with the network reference", async () => {
    const db = await createTestDb();
    const gateway = fakeGateway(() => Response.json({ ref: 12 }));
    const transport = createTransport("modem", { db, gateway: { url: "http://gateway.test", secret: SECRET, fetch: gateway.fetch } });
    expect(transport.kind).toBe("modem");

    await transport.send("+213550000001", "SVXACK#3F9A12BC");

    expect(gateway.calls).toEqual([
      {
        url: "http://gateway.test/send",
        authorization: `Bearer ${SECRET}`,
        body: { to: "+213550000001", body: "SVXACK#3F9A12BC" },
      },
    ]);
    const outbox = await listOutbox(db);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ direction: "out", body: "SVXACK#3F9A12BC", emulated: false, status: "sent", modemRef: "12" });
    expect(JSON.stringify(outbox[0])).not.toContain("+213550000001");
  });

  it("records a text the gateway could not send as failed, and lets the caller know", async () => {
    const db = await createTestDb();
    const unavailable = createTransport("modem", {
      db,
      gateway: { url: "http://gateway.test", secret: SECRET, fetch: fakeGateway(() => Response.json({ error: "modem_unavailable" }, { status: 503 })).fetch },
    });
    const unreachable = createTransport("modem", {
      db,
      gateway: { url: "http://gateway.test", secret: SECRET, fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch },
    });

    await expect(unavailable.send("+213550000001", "a")).rejects.toThrow(/gateway.*503/i);
    await expect(unreachable.send("+213550000001", "b")).rejects.toThrow(/gateway/i);

    const outbox = await listOutbox(db);
    expect(outbox.map((m) => [m.body, m.status]).sort()).toEqual([["a", "failed"], ["b", "failed"]]);
  });
});
