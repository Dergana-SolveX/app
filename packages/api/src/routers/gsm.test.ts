import { cellTowers } from "@solvex-dergana/db/schema/index";
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
    db,
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

describe("gsm.inject: the feature-phone menu", () => {
  it("answers ACCIDENT in the outbox, and the finished conversation shows up as an emulated incident", async () => {
    const { gsm, incidents } = await setup();
    const from = "+213550000077";

    for (const text of ["ACCIDENT", "2", "1", "0", "Rouiba"]) await gsm.inject({ from, body: text });

    const outbox = await gsm.outbox();
    expect(outbox).toHaveLength(5);
    expect(outbox.every((sms) => sms.emulated)).toBe(true);
    expect(outbox[0]!.body).toMatch(/^SVXACK#/);
    expect(outbox[4]!.body).toMatch(/victimes/i);

    const list = await incidents.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ commune: "Rouiba", emulated: true });
  });
});

describe("gsm.ussd (the USSD operator emulator)", () => {
  // A made-up tower id (test data) at El Harrach's real position.
  const tower = { mcc: 603, mnc: 1, lac: 100, cid: 2, lat: 36.7197, lng: 3.1347, rangeM: 900, source: "opencellid" as const };
  const ELHARRACH_AREA = { lat: 36.72, lng: 3.14 };
  const dialAll = async (gsm: Awaited<ReturnType<typeof setup>>["gsm"], near?: { lat: number; lng: number }) => {
    let last;
    for (const text of ["", "2", "2*1", "2*1*1", "2*1*1*0", "2*1*1*0*1"]) {
      last = await gsm.ussd({ sessionId: "E1", phoneNumber: "+213550000042", text, near });
    }
    return last!;
  };

  it("presents a real tower near the chosen point, and the alert it files is located there and flagged emulated", async () => {
    const { db, gsm, incidents } = await setup();
    await db.insert(cellTowers).values(tower);

    const first = await gsm.ussd({ sessionId: "E0", phoneNumber: "+213550000042", text: "", near: ELHARRACH_AREA });
    expect(first).toMatchObject({ type: "CON", tower: { cellId: "603-1-100-2", rangeM: 900 } });
    expect(first.tower!.distanceM).toBeLessThan(1_000);

    const last = await dialAll(gsm, ELHARRACH_AREA);

    expect(last.type).toBe("END");
    const [incident] = await incidents.list();
    expect(incident).toMatchObject({ lat: 36.7197, lng: 3.1347, locationUncertaintyM: 900, emulated: true });
  });

  it("still works with no tower in reach: it says so, and the alert is filed without a position", async () => {
    const { gsm, incidents } = await setup(); // no towers imported
    const first = await gsm.ussd({ sessionId: "E0", phoneNumber: "+213550000042", text: "", near: ELHARRACH_AREA });
    expect(first.tower).toBeNull();

    await dialAll(gsm, ELHARRACH_AREA);

    expect(await incidents.list()).toMatchObject([{ lat: null, lng: null }]);
  });

  it("is admin only", async () => {
    for (const role of ["dispatcher", "medic", "hospital"] as const) {
      const { gsm } = await setup(role);
      await expect(gsm.ussd({ sessionId: "E", phoneNumber: "+213550000042", text: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
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
