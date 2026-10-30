import type { AppUserContext, Context } from "@solvex-dergana/api/context";
import { appRouter } from "@solvex-dergana/api/routers/index";
import { t } from "@solvex-dergana/api";
import { createEventBus } from "@solvex-dergana/api/services/events";
import { createTransport } from "@solvex-dergana/api/sms/transport";
import { createTestDb } from "@solvex-dergana/db/testing";
import { masterIncidents, rawAlerts, smsLog, vehicles } from "@solvex-dergana/db/schema/index";
import { deriveDeviceKey, deviceKeyCheck } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { createDeviceApp } from "./device-routes";

const MASTER = "svx-device-master-secret-for-testing-32!";
const DEVICE_ID = "SVX-CHIP-001";
const MSISDN = "+213550111222";

const packet = {
  cause: "impact" as const, impacts: 2, peakG: 31.5, deltaVKmh: 64.2, saturated: false,
  rollover: false, rolloverDeg: null, fire: false,
};
const position = { lat: 36.7538, lng: 3.0588 };

async function setup(options: { role?: AppUserContext["role"]; secret?: string; noChip?: boolean } = {}) {
  const db = await createTestDb();
  const events = createEventBus();
  await db.insert(vehicles).values({
    deviceId: DEVICE_ID,
    deviceSecretHash: await deviceKeyCheck(await deriveDeviceKey(MASTER, DEVICE_ID)),
    simMsisdn: MSISDN,
    makeModel: "Peugeot 301",
  });
  const deviceApp = createDeviceApp({ masterDeviceSecret: MASTER, db, events });
  const ctx = {
    db,
    events,
    smsTransport: createTransport("emulator", { db }),
    session: { user: { id: "auth" } },
    appUser: { id: "u1", role: options.role ?? "admin", unitId: null, hospitalId: null },
    chip: options.noChip
      ? undefined
      : {
          masterDeviceSecret: options.secret ?? MASTER,
          baseUrl: "http://svx.test",
          // The chip's HTTP request goes to the real device endpoint, in process.
          fetch: (input: string | URL | Request, init?: RequestInit) => deviceApp.request(new URL(String(input)).pathname, init),
        },
  } as unknown as Context;
  return { db, events, caller: t.createCallerFactory(appRouter)(ctx) };
}

const send = (caller: Awaited<ReturnType<typeof setup>>["caller"], over: Record<string, unknown> = {}) =>
  caller.chip.transmit({ channel: "http", packet, position, eventAt: Date.now(), attempt: 1, ...over } as never);

describe("chip.transmit by the web: a signed event on the real device endpoint", () => {
  it("makes an incident from the chip's packet, flagged as emulated and as a synthetic trace", async () => {
    const { caller, db } = await setup();
    const answer = await send(caller);
    expect(answer).toMatchObject({ ok: true, channel: "http" });
    expect(answer.ack).toMatch(/^SVXACK/);
    expect(await db.select().from(masterIncidents)).toHaveLength(1);
    const [alert] = await db.select().from(rawAlerts);
    expect(alert).toMatchObject({
      source: "iot", channel: "internet", emulated: true, traceInjected: true, authenticated: true,
      impacts: 2, saturated: false, rollover: false, fire: false,
    });
    expect(alert!.gForce).toBeCloseTo(31.5, 3);
    expect(alert!.deltaVKmh).toBeCloseTo(64.2, 3);
    expect(alert!.lat).toBeCloseTo(36.7538, 4);
  });

  it("carries the rollover, the fire and the saturation of the packet", async () => {
    const { caller, db } = await setup();
    await send(caller, { packet: { ...packet, cause: "rollover", impacts: 0, saturated: true, rollover: true, rolloverDeg: 178, fire: true, peakG: 200 } });
    const [alert] = await db.select().from(rawAlerts);
    expect(alert).toMatchObject({ rollover: true, fire: true, saturated: true, impacts: 0 });
    expect(alert!.rolloverDeg).toBe(178);
  });

  it("tells the dispatchers at once, on their channel", async () => {
    const { caller, events } = await setup();
    const stream = events.stream(undefined, undefined);
    await stream.next(); // ready
    const heard = stream.next();
    await send(caller);
    expect((await heard).value!.event).toMatchObject({ type: "incident.created" });
    await stream.return(undefined);
  });

  it("is really signed: a chip with the wrong secret is refused by the endpoint", async () => {
    const { caller, db } = await setup({ secret: "another-master-secret-that-is-wrong-0001" });
    // Not UNAUTHORIZED: that would look like the presenter's own session was lost.
    await expect(send(caller)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.select().from(masterIncidents)).toHaveLength(0);
  });

  it("keeps the time of the crash when the event is sent late (a retry after a long wait)", async () => {
    const { caller, db } = await setup();
    const crashedAt = Date.now() - 25_000;
    await send(caller, { eventAt: crashedAt });
    const [alert] = await db.select().from(rawAlerts);
    expect(Math.abs(alert!.eventAt!.getTime() - crashedAt)).toBeLessThan(1000);
  });

  it("ignores a crash time that cannot be true (two days ago), as for any device", async () => {
    const { caller, db } = await setup();
    await send(caller, { eventAt: Date.now() - 48 * 3_600_000 });
    const [alert] = await db.select().from(rawAlerts);
    expect(Math.abs(alert!.eventAt!.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("accepts a crash time with fractions of a millisecond: the page's clock produces them", async () => {
    const { caller, db } = await setup();
    const crashedAt = Date.now() - 12_345.678;
    const answer = await send(caller, { eventAt: crashedAt });
    expect(answer.ok).toBe(true);
    const [alert] = await db.select().from(rawAlerts);
    expect(Math.abs(alert!.eventAt!.getTime() - crashedAt)).toBeLessThan(1000);
  });

  it("does not make a second alert when the same event is sent again", async () => {
    const { caller, db } = await setup();
    const eventAt = Date.now() - 12_000;
    const first = await send(caller, { eventAt });
    const again = await send(caller, { eventAt, attempt: 2 });
    expect(again.incidentId).toBe(first.incidentId);
    expect(await db.select().from(rawAlerts)).toHaveLength(1);
  });
});

describe("chip.transmit by SMS (zone blanche): the real SVX string through the emulator", () => {
  it("sends a signed SVX message from the chip's SIM, which becomes an incident", async () => {
    const { caller, db } = await setup();
    const answer = await send(caller, { channel: "sms" });
    expect(answer).toMatchObject({ ok: true, channel: "sms" });
    expect(answer.sms).toMatch(/^SVX1#/);
    expect(answer.sms!.length).toBeLessThanOrEqual(160);
    expect(answer.incidentId).toBeTruthy();

    const [alert] = await db.select().from(rawAlerts);
    expect(alert).toMatchObject({ source: "iot", channel: "sms", emulated: true, authenticated: true, rollover: false, fire: false });
    expect(alert!.gForce).toBeCloseTo(31.5, 0);
    const log = await db.select().from(smsLog);
    expect(log.find((row) => row.direction === "in")!.body).toBe(answer.sms);
    expect(log.find((row) => row.direction === "in")!.emulated).toBe(true);
  });

  it("dates the alert from the crash, to the minute", async () => {
    const { caller, db } = await setup();
    const crashedAt = Date.now() - 5 * 60_000;
    await send(caller, { channel: "sms", eventAt: crashedAt });
    const [alert] = await db.select().from(rawAlerts);
    expect(Math.abs(alert!.eventAt!.getTime() - crashedAt)).toBeLessThan(90_000);
  });
});

describe("chip.transmit: who, what and where", () => {
  it.each(["dispatcher", "medic", "hospital"] as const)("is closed to a %s", async (role) => {
    const { caller } = await setup({ role });
    await expect(send(caller)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("says so when the device does not exist, on either channel", async () => {
    const { caller } = await setup();
    await expect(send(caller, { deviceId: "SVX-CHIP-404" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(send(caller, { deviceId: "SVX-CHIP-404", channel: "sms" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a packet or a position that cannot be real", async () => {
    const { caller } = await setup();
    await expect(send(caller, { packet: { ...packet, peakG: -1 } })).rejects.toThrow();
    await expect(send(caller, { position: { lat: 120, lng: 3 } })).rejects.toThrow();
    await expect(send(caller, { packet: { ...packet, cause: "meteor" } })).rejects.toThrow();
  });

  it("says plainly when the server has no chip gateway configured", async () => {
    const { caller } = await setup({ noChip: true });
    await expect(send(caller)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("chip.heartbeat: the chip reports it is alive", () => {
  it("updates the vehicle's last heartbeat and telemetry through the signed endpoint", async () => {
    const { caller, db } = await setup();
    await caller.chip.heartbeat({ state: "ARMED", batteryPct: 90 } as never);
    const [vehicle] = await db.select().from(vehicles);
    expect(vehicle!.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(vehicle!.lastTelemetry).toMatchObject({ state: "ARMED", batteryPct: 90, emulated: true });
  });

  it("is closed to anyone but the admin", async () => {
    const { caller } = await setup({ role: "medic" });
    await expect(caller.chip.heartbeat({ state: "IDLE" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
