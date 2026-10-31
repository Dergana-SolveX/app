import { describe, expect, it, vi } from "vitest";

import { createGateway } from "../gateway";
import { createAndroidRelayService } from "./relay";

const SECRET = "test-gateway-secret-0123456789ab";
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

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

describe("Android Relay Gateway (FR-S3-08)", () => {
  it("relays an incoming SMS from an Android device fixture to the server", async () => {
    const server = fakeServer(() =>
      Response.json({
        result: { kind: "alert", incidentId: "inc-123", ack: "SVXACK#12345678" },
        replies: [{ to: "+213550000001", body: "SVXACK#12345678" }],
      }),
    );

    const android = createAndroidRelayService({ log: quiet });
    createGateway({
      modem: android,
      serverUrl: "http://server.test",
      secret: SECRET,
      fetch: server.fetch,
      retryDelayMs: 1,
      log: quiet,
    });

    android.start();
    expect(android.status()).toBe("connected");

    // Android device receives an SMS in the field
    await android.receiveFromDevice({
      from: "+213550000001",
      body: "SVX1#L:2#GH:sn2j5x7k#T:j9w4#V:1#C:1#CK:7F",
      receivedAt: new Date("2026-10-31T10:00:00Z"),
    });

    expect(server.calls).toEqual([
      {
        path: "/internal/sms",
        authorization: `Bearer ${SECRET}`,
        body: {
          from: "+213550000001",
          body: "SVX1#L:2#GH:sn2j5x7k#T:j9w4#V:1#C:1#CK:7F",
          receivedAt: "2026-10-31T10:00:00.000Z",
          emulated: false,
        },
      },
    ]);

    // Outbox on the android relay should have sent the ack reply
    expect(android.sentSms).toHaveLength(1);
    expect(android.sentSms[0]).toEqual({
      to: "+213550000001",
      body: "SVXACK#12345678",
      ref: expect.any(Number),
    });

    android.stop();
    expect(android.status()).toBe("stopped");
  });

  it("relays delivery reports from the Android phone to the server", async () => {
    const server = fakeServer();
    const android = createAndroidRelayService({ log: quiet });
    createGateway({
      modem: android,
      serverUrl: "http://server.test",
      secret: SECRET,
      fetch: server.fetch,
      retryDelayMs: 1,
      log: quiet,
    });

    android.start();
    android.reportDeliveryFromDevice({ ref: 101, status: "delivered" });

    await vi.waitFor(() => expect(server.calls).toHaveLength(1));
    expect(server.calls[0]).toEqual({
      path: "/internal/sms/status",
      authorization: `Bearer ${SECRET}`,
      body: { ref: 101, status: "delivered" },
    });

    android.stop();
  });

  it("handles outbound POST /send from the server and delivers via Android device", async () => {
    const android = createAndroidRelayService({ log: quiet });
    const gateway = createGateway({
      modem: android,
      serverUrl: "http://server.test",
      secret: SECRET,
      log: quiet,
    });

    android.start();

    const response = await gateway.app.request("/send", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ to: "+213550000002", body: "SVXACK#ABCDEF12" }),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { ref: number };
    expect(typeof json.ref).toBe("number");
    expect(android.sentSms).toContainEqual({
      to: "+213550000002",
      body: "SVXACK#ABCDEF12",
      ref: json.ref,
    });

    android.stop();
  });
});
