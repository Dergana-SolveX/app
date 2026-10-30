import { createTestDb } from "@solvex-dergana/db/testing";
import { encodeSvx, type SvxAlert } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { t } from "../index";
import { createEventBus } from "../services/events";
import { createTransport } from "../sms/transport";
import { gsmRouter } from "./gsm";
import { incidentsRouter } from "./incidents";

const alert: SvxAlert = {
  layer: 2,
  geohash: "sn2j5x7k",
  eventMinutes: 29889180,
  peakG: null,
  rollover: null,
  fire: false,
  victims: 2,
  conscious: 1,
  trapped: false,
  bleeding: false,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
};

async function setup(role: AppUserContext["role"] = "admin") {
  const db = await createTestDb();
  const ctx = {
    db,
    events: createEventBus(),
    smsTransport: createTransport("emulator", { db }),
    session: { user: { id: "auth-1" } },
    appUser: { id: "u1", role, unitId: null, hospitalId: null },
  } as unknown as Context;
  return {
    gsm: t.createCallerFactory(gsmRouter)(ctx),
    incidents: t.createCallerFactory(incidentsRouter)(ctx),
  };
}

describe("gsm.inject (the emulated GSM network panel)", () => {
  it("delivers an SMS exactly like a real gateway would: incident, ack in the outbox, both on the wire log", async () => {
    const { gsm, incidents } = await setup();
    const body = encodeSvx(alert);

    const result = await gsm.inject({ from: "+213550000001", body });

    if (result.kind !== "alert") throw new Error("expected an alert");
    expect(await incidents.list()).toHaveLength(1);

    const outbox = await gsm.outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ body: result.ack, emulated: true });

    const wire = await gsm.wire();
    expect(wire.map((w) => w.direction).sort()).toEqual(["in", "out"]);
    expect(wire.every((w) => w.emulated)).toBe(true);
    expect(wire.find((w) => w.direction === "in")).toMatchObject({
      body,
      size: body.length,
      result: { recognized: true, crcValid: true },
    });
  });

  it("flags everything it injects as emulated and never stores the phone number", async () => {
    const { gsm } = await setup();
    await gsm.inject({ from: "+213550000001", body: encodeSvx(alert) });
    const wire = await gsm.wire();
    expect(wire.every((w) => w.emulated)).toBe(true);
    expect(JSON.stringify(wire)).not.toContain("+213550000001");
  });

  it("is admin only: dispatchers, medics and hospital staff are refused", async () => {
    for (const role of ["dispatcher", "medic", "hospital"] as const) {
      const { gsm } = await setup(role);
      await expect(gsm.inject({ from: "+213550000001", body: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(gsm.wire()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(gsm.outbox()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

describe("gsm.inject: input limits", () => {
  it("rejects absurdly long messages and phone numbers", async () => {
    const { gsm } = await setup();
    await expect(gsm.inject({ from: "+213550000001", body: "x".repeat(5000) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(gsm.inject({ from: "9".repeat(100), body: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
