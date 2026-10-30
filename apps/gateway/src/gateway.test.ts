import { describe, expect, it, vi } from "vitest";

import { createGateway } from "./gateway";
import { createModemService } from "./modem/service";
import { replayLink } from "./testing/replay-link";
import { HEX, initSteps, OK } from "./testing/transcripts";

const SECRET = "test-gateway-secret-0123456789ab";
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

/** The SVX server, as seen from the gateway: records what it is sent and answers as told. */
function fakeServer(answer: (path: string, body: unknown) => Response = () => Response.json({ result: {}, replies: [] })) {
  const calls: { path: string; authorization: string | null; body: any }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body));
    calls.push({ path, authorization: new Headers(init?.headers).get("authorization"), body });
    return answer(path, body);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

async function setup(steps: Parameters<typeof replayLink>[0], server = fakeServer()) {
  const modem = replayLink(steps);
  const service = createModemService({ open: async () => modem.link, log: quiet });
  const gateway = createGateway({
    modem: service,
    serverUrl: "http://server.test",
    secret: SECRET,
    fetch: server.fetch,
    retryDelayMs: 1,
    log: quiet,
  });
  service.start();
  await service.whenConnected();
  const untilDone = () => vi.waitFor(() => expect(modem.remaining()).toEqual([]));
  return { modem, service, gateway, server, untilDone };
}

const read = (index: number, hexFrom: string, hexBody: string) => ({
  host: `AT+CMGR=${index}\r`,
  modem: `\r\n+CMGR: "REC UNREAD","${hexFrom}","","26/10/30,12:00:00+04"\r\n${hexBody}\r\n` + OK,
});

describe("gateway: an SMS arrives", () => {
  it("hands it to the server with the shared secret, texts back what the server answers, and only then deletes it", async () => {
    const server = fakeServer(() => Response.json({ result: { kind: "menu" }, replies: [{ to: "+213550000001", body: "ACK" }] }));
    const { untilDone, service, modem } = await setup(
      [
        ...initSteps(),
        { modem: '\r\n+CMTI: "SM",3\r\n' },
        read(3, HEX.plus213550000001, HEX.accident),
        { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n> " },
        { host: "00410043004B\x1a", modem: "\r\n+CMGS: 5\r\n" + OK }, // "ACK"
        { host: "AT+CMGD=3\r", modem: OK },
      ],
      server,
    );

    await untilDone();

    expect(server.calls).toEqual([
      {
        path: "/internal/sms",
        authorization: `Bearer ${SECRET}`,
        body: { from: "+213550000001", body: "ACCIDENT", receivedAt: "2026-10-30T11:00:00.000Z", emulated: false },
      },
    ]);
    expect(modem.remaining()).toEqual([]);
    service.stop();
  });

  it("leaves the message on the SIM when the server cannot be reached, after trying a few times", async () => {
    const server = fakeServer(() => new Response("down", { status: 503 }));
    const { service, modem } = await setup(
      [...initSteps(), { modem: '\r\n+CMTI: "SM",3\r\n' }, read(3, HEX.plus213550000001, HEX.accident)],
      server,
    );

    await vi.waitFor(() => expect(server.calls).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(modem.written).not.toContain("AT+CMGD=3\r"); // still on the SIM: the next sweep offers it again
    service.stop();
  });

  it("does not retry a refusal that retrying cannot fix (wrong secret)", async () => {
    const server = fakeServer(() => Response.json({ error: "unauthorized" }, { status: 401 }));
    const { service } = await setup(
      [...initSteps(), { modem: '\r\n+CMTI: "SM",3\r\n' }, read(3, HEX.plus213550000001, HEX.accident)],
      server,
    );

    await vi.waitFor(() => expect(server.calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(server.calls).toHaveLength(1);
    service.stop();
  });
});

describe("gateway: texting back", () => {
  it("still deletes the message when the reply cannot be sent: the server has it, and a repeat would be recognised", async () => {
    const server = fakeServer(() => Response.json({ result: {}, replies: [{ to: "+213550000001", body: "ACK" }] }));
    const { untilDone, service } = await setup(
      [
        ...initSteps(),
        { modem: '\r\n+CMTI: "SM",3\r\n' },
        read(3, HEX.plus213550000001, HEX.accident),
        { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n+CMS ERROR: 331\r\n" }, // no network
        { host: "AT+CMGD=3\r", modem: OK },
      ],
      server,
    );

    await untilDone();
    service.stop();
  });
});

describe("gateway: delivery reports", () => {
  it("tells the server whether a sent text was delivered", async () => {
    const report = `\r\n+CDS: 6,40,"${HEX.plus213550000001}",145,"26/10/30,12:00:00+04","26/10/30,12:00:05+04",0\r\n`;
    const { server, service } = await setup([...initSteps(), { modem: report }]);

    await vi.waitFor(() => expect(server.calls).toHaveLength(1));

    expect(server.calls[0]).toEqual({
      path: "/internal/sms/status",
      authorization: `Bearer ${SECRET}`,
      body: { ref: 40, status: "delivered" },
    });
    service.stop();
  });
});

describe("gateway: POST /send (the server texts through the modem)", () => {
  const send = (gateway: ReturnType<typeof createGateway>, body: unknown, headers: Record<string, string> = {}) =>
    gateway.app.request("/send", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}`, ...headers },
      body: JSON.stringify(body),
    });

  it("sends the text and answers with the reference the network gave it", async () => {
    const { gateway, service, untilDone } = await setup([
      ...initSteps(),
      { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n> " },
      { host: `${HEX.ack}\x1a`, modem: "\r\n+CMGS: 12\r\n" + OK },
    ]);

    const response = await send(gateway, { to: "+213550000001", body: "SVXACK#AB12CD34" });
    await untilDone();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ref: 12 });
    service.stop();
  });

  it("refuses a caller without the secret, and a malformed request", async () => {
    const { gateway, service } = await setup(initSteps());

    expect((await send(gateway, { to: "+213550000001", body: "x" }, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await send(gateway, { to: "+213550000001" })).status).toBe(400);
    expect((await send(gateway, { to: "", body: "x" })).status).toBe(400);
    service.stop();
  });

  it("says 503 when the modem is not connected, and 422 for a text too long for one SMS", async () => {
    const { gateway, service } = await setup(initSteps());

    expect((await send(gateway, { to: "+213550000001", body: "a".repeat(161) })).status).toBe(422);

    service.stop();
    const down = await send(gateway, { to: "+213550000001", body: "hello" });
    expect(down.status).toBe(503);
  });

  it("reports whether the modem is connected", async () => {
    const { gateway, service } = await setup(initSteps());
    const health = await gateway.app.request("/health");
    expect(await health.json()).toEqual({ modem: "connected" });
    service.stop();
  });
});
