import { createTransport } from "@solvex-dergana/api/sms/transport";
import { createEventBus } from "@solvex-dergana/api/services/events";
import { listOutbox } from "@solvex-dergana/api/services/wire";
import { createTestDb } from "@solvex-dergana/db/testing";
import { encodeSvx, type SvxAlert } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { createInternalSmsApp } from "./internal-sms";

const SECRET = "test-gateway-secret-0123456789ab";

const alert: SvxAlert = {
  layer: 2,
  geohash: "sn2j5x7k",
  eventMinutes: 29889180,
  peakG: null,
  rollover: null,
  fire: false,
  victims: 2,
  conscious: 1,
  trapped: true,
  bleeding: false,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
};

async function setup() {
  const db = await createTestDb();
  const transport = createTransport("emulator", { db });
  const events = createEventBus();
  const app = createInternalSmsApp({ secret: SECRET, db, transport, events });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request("/internal/sms", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { post, db, events };
}

describe("POST /internal/sms", () => {
  const sms = () => ({ from: "+213550000001", body: encodeSvx(alert) });

  it("hands the gateway the menu questions to text back to a feature phone", async () => {
    const { post } = await setup();
    const headers = { authorization: `Bearer ${SECRET}` };

    const res = await post({ from: "+213550000009", body: "ACCIDENT" }, headers);

    expect(res.status).toBe(200);
    const { replies } = (await res.json()) as { replies: { to: string; body: string }[] };
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ to: "+213550000009" });
    expect(replies[0]!.body).toMatch(/victimes/i);
  });

  it("rejects a request without the gateway secret", async () => {
    const { post } = await setup();
    expect((await post(sms())).status).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const { post } = await setup();
    expect((await post(sms(), { authorization: "Bearer not-the-secret" })).status).toBe(401);
  });

  it("rejects a malformed body with 400 (after authentication)", async () => {
    const { post } = await setup();
    const res = await post({ nope: true }, { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(400);
  });

  it("ingests the SMS and returns the ack for the gateway to send back", async () => {
    const { post } = await setup();
    const res = await post(sms(), { authorization: `Bearer ${SECRET}` });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result: { kind: string; incidentId: string; ack: string };
      replies: { to: string; body: string }[];
    };
    expect(json.result.kind).toBe("alert");
    expect(json.replies).toEqual([{ to: "+213550000001", body: json.result.ack }]);
    expect(json.result.ack).toMatch(/^SVXACK#[0-9A-F]{8}$/);
  });

  it("sends the ack through the transport, so it appears in the outbox", async () => {
    const { post, db } = await setup();
    const res = await post(sms(), { authorization: `Bearer ${SECRET}` });
    const json = (await res.json()) as { result: { ack: string; incidentId: string } };

    const outbox = await listOutbox(db);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      body: json.result.ack,
      incidentId: json.result.incidentId,
      emulated: true,
    });
  });

  it("announces the new incident on the dispatcher stream", async () => {
    const { post, events } = await setup();
    const stream = events.stream();
    expect((await stream.next()).value?.event).toEqual({ type: "ready" });

    await post(sms(), { authorization: `Bearer ${SECRET}` });
    const next = await stream.next();
    expect(next.value?.event).toMatchObject({ type: "incident.created" });
    await stream.return(undefined);
  });

  it("sends nothing for text that is not an SVX alert", async () => {
    const { post, db } = await setup();
    await post({ from: "+213550000001", body: "Bonjour" }, { authorization: `Bearer ${SECRET}` });
    expect(await listOutbox(db)).toEqual([]);
  });

  it("returns no reply for text that is not an SVX alert", async () => {
    const { post } = await setup();
    const res = await post(
      { from: "+213550000001", body: "Bonjour" },
      { authorization: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { kind: string }; replies: unknown[] };
    expect(json.result.kind).toBe("ignored");
    expect(json.replies).toEqual([]);
  });
});

describe("createInternalSmsApp: gateway secret", () => {
  it("refuses to start with an empty or too short secret, so a blank Bearer token can never pass", async () => {
    const db = await createTestDb();
    const transport = createTransport("emulator", { db });
    const events = createEventBus();
    expect(() => createInternalSmsApp({ secret: "", db, transport, events })).toThrow(/secret/i);
    expect(() => createInternalSmsApp({ secret: "short", db, transport, events })).toThrow(/secret/i);
  });
});

describe("POST /internal/sms/status (delivery reports from the gateway)", () => {
  /** A server whose transport is the modem, with a fake gateway that hands out the given references in order. */
  async function modemSetup(refs: number[]) {
    const db = await createTestDb();
    const queue = [...refs];
    const transport = createTransport("modem", {
      db,
      gateway: {
        url: "http://gateway.test",
        secret: SECRET,
        fetch: (async () => Response.json({ ref: queue.shift() })) as unknown as typeof fetch,
      },
    });
    const app = createInternalSmsApp({ secret: SECRET, db, transport, events: createEventBus() });
    const report = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
      app.request("/internal/sms/status", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const statuses = async () => (await listOutbox(db)).map((m) => [m.body, m.status]).sort();
    return { transport, report, statuses };
  }

  it("marks a sent text delivered or failed, found by the reference the network gave it", async () => {
    const { transport, report, statuses } = await modemSetup([12, 13]);
    await transport.send("+213550000001", "a");
    await transport.send("+213550000002", "b");

    const delivered = await report({ ref: 12, status: "delivered" });
    const failed = await report({ ref: 13, status: "failed" });

    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toEqual({ updated: true });
    expect(await failed.json()).toEqual({ updated: true });
    expect(await statuses()).toEqual([["a", "delivered"], ["b", "failed"]]);
  });

  it("applies a report to the most recent text with that reference (the modem reuses numbers)", async () => {
    const { transport, report, statuses } = await modemSetup([5, 5]);
    await transport.send("+213550000001", "old");
    await report({ ref: 5, status: "delivered" });
    await transport.send("+213550000001", "new"); // the counter wrapped: reference 5 again

    await report({ ref: 5, status: "failed" });

    expect(await statuses()).toEqual([["new", "failed"], ["old", "delivered"]]);
  });

  it("says nothing was updated for a reference it does not know", async () => {
    const { report } = await modemSetup([]);
    const response = await report({ ref: 99, status: "delivered" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: false });
  });

  it("is for the gateway only, and refuses a malformed report", async () => {
    const { report } = await modemSetup([]);
    expect((await report({ ref: 1, status: "delivered" }, {})).status).toBe(401);
    expect((await report({ ref: 1, status: "delivered" }, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await report({ ref: "x", status: "delivered" })).status).toBe(400);
    expect((await report({ ref: 1, status: "pending" })).status).toBe(400);
  });
});

describe("POST /internal/sms when the server texts through the modem", () => {
  it("texts the phone once: the server sends through the gateway, so it must not also return the same text as a reply", async () => {
    const db = await createTestDb();
    const sent: { to: string; body: string }[] = [];
    const transport = createTransport("modem", {
      db,
      gateway: {
        url: "http://gateway.test",
        secret: SECRET,
        fetch: (async (_url: unknown, init?: RequestInit) => {
          sent.push(JSON.parse(String(init?.body)));
          return Response.json({ ref: sent.length });
        }) as unknown as typeof fetch,
      },
    });
    const app = createInternalSmsApp({ secret: SECRET, db, transport, events: createEventBus() });

    const response = await app.request("/internal/sms", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ from: "+213550000009", body: "ACCIDENT" }),
    });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1); // the menu question, sent once through the gateway
    expect(sent[0]).toMatchObject({ to: "+213550000009" });
    expect(((await response.json()) as { replies: unknown[] }).replies).toEqual([]);
  });
});

describe("POST /internal/sms when the server texts through an android relay gateway", () => {
  it("texts the phone once: the server sends through the android gateway /send, so replies in response is empty", async () => {
    const db = await createTestDb();
    const sent: { to: string; body: string }[] = [];
    const transport = createTransport("android", {
      db,
      gateway: {
        url: "http://android-gateway.test",
        secret: SECRET,
        fetch: (async (_url: unknown, init?: RequestInit) => {
          sent.push(JSON.parse(String(init?.body)));
          return Response.json({ ref: "AND-" + sent.length });
        }) as unknown as typeof fetch,
      },
    });
    const app = createInternalSmsApp({ secret: SECRET, db, transport, events: createEventBus() });

    const response = await app.request("/internal/sms", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ from: "+213550000009", body: "ACCIDENT" }),
    });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1); // the menu question, sent once through the android gateway
    expect(sent[0]).toMatchObject({ to: "+213550000009" });
    expect(((await response.json()) as { replies: unknown[] }).replies).toEqual([]);
  });
});
