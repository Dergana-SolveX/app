import { createTestDb } from "@solvex-dergana/db/testing";
import { describe, expect, it, vi } from "vitest";

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

  it("refuses unknown transport names with a clear error", async () => {
    const db = await createTestDb();
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

  it("has the text on record as queued before the gateway answers, so nothing that happens later can lose it", async () => {
    const db = await createTestDb();
    let answer: (response: Response) => void = () => {};
    const slow = (async () => new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch;
    const transport = createTransport("modem", { db, gateway: { url: "http://gateway.test", secret: SECRET, fetch: slow } });

    const sending = transport.send("+213550000001", "SVXACK#3F9A12BC");
    await vi.waitFor(async () => expect((await listOutbox(db)).map((m) => m.status)).toEqual(["queued"]));

    answer(Response.json({ ref: 12 }));
    await sending;
    expect((await listOutbox(db)).map((m) => [m.status, m.modemRef])).toEqual([["sent", "12"]]);
  });

  it("gives up on a gateway that does not answer, and records the text as failed", async () => {
    const db = await createTestDb();
    const hangs = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    const transport = createTransport("modem", { db, gateway: { url: "http://gateway.test", secret: SECRET, fetch: hangs, timeoutMs: 20 } });

    await expect(transport.send("+213550000001", "a")).rejects.toThrow(/did not answer/i);

    expect((await listOutbox(db)).map((m) => m.status)).toEqual(["failed"]);
  });

  it("treats an answer without a network reference as a failure instead of guessing", async () => {
    const db = await createTestDb();
    const transport = createTransport("modem", {
      db,
      gateway: { url: "http://gateway.test", secret: SECRET, fetch: fakeGateway(() => Response.json({ nope: true })).fetch },
    });

    await expect(transport.send("+213550000001", "a")).rejects.toThrow(/reference/i);

    expect((await listOutbox(db)).map((m) => m.status)).toEqual(["failed"]);
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

describe("createTransport: android (relay phone gateway)", () => {
  it("needs to know where the gateway is", async () => {
    const db = await createTestDb();
    expect(() => createTransport("android", { db })).toThrow(/GATEWAY_URL/);
  });

  it("sends through the android gateway with the shared secret, and logs a real (not emulated) SMS with the network reference", async () => {
    const db = await createTestDb();
    const gateway = fakeGateway(() => Response.json({ ref: "AND-42" }));
    const transport = createTransport("android", { db, gateway: { url: "http://android-gateway.test", secret: SECRET, fetch: gateway.fetch } });
    expect(transport.kind).toBe("android");

    await transport.send("+213550000001", "SVXACK#3F9A12BC");

    expect(gateway.calls).toEqual([
      {
        url: "http://android-gateway.test/send",
        authorization: `Bearer ${SECRET}`,
        body: { to: "+213550000001", body: "SVXACK#3F9A12BC" },
      },
    ]);
    const outbox = await listOutbox(db);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ direction: "out", body: "SVXACK#3F9A12BC", emulated: false, status: "sent", modemRef: "AND-42" });
    expect(JSON.stringify(outbox[0])).not.toContain("+213550000001");
  });

  it("has the text on record as queued before the gateway answers", async () => {
    const db = await createTestDb();
    let answer: (response: Response) => void = () => {};
    const slow = (async () => new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch;
    const transport = createTransport("android", { db, gateway: { url: "http://android-gateway.test", secret: SECRET, fetch: slow } });

    const sending = transport.send("+213550000001", "SVXACK#3F9A12BC");
    await vi.waitFor(async () => expect((await listOutbox(db)).map((m) => m.status)).toEqual(["queued"]));

    answer(Response.json({ ref: "AND-42" }));
    await sending;
    expect((await listOutbox(db)).map((m) => [m.status, m.modemRef])).toEqual([["sent", "AND-42"]]);
  });

  it("gives up on an android gateway that does not answer, and records the text as failed", async () => {
    const db = await createTestDb();
    const hangs = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    const transport = createTransport("android", { db, gateway: { url: "http://android-gateway.test", secret: SECRET, fetch: hangs, timeoutMs: 20 } });

    await expect(transport.send("+213550000001", "a")).rejects.toThrow(/did not answer/i);

    expect((await listOutbox(db)).map((m) => m.status)).toEqual(["failed"]);
  });

  it("records a text the android gateway could not send as failed", async () => {
    const db = await createTestDb();
    const failed = createTransport("android", {
      db,
      gateway: { url: "http://android-gateway.test", secret: SECRET, fetch: fakeGateway(() => Response.json({ error: "relay_busy" }, { status: 503 })).fetch },
    });

    await expect(failed.send("+213550000001", "a")).rejects.toThrow(/gateway.*503/i);

    const outbox = await listOutbox(db);
    expect(outbox.map((m) => [m.body, m.status])).toEqual([["a", "failed"]]);
  });
});
