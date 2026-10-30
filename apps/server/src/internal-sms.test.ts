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
