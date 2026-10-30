import { createTestDb } from "@solvex-dergana/db/testing";
import { describe, expect, it } from "vitest";

import { createEventBus } from "./events";
import { listOutbox, listWireLog } from "./wire";
import { getIncident, listIncidents } from "./incidents";
import { createTransport } from "../sms/transport";
import { receiveSms } from "./sms-flow";

const PHONE = "+213550000042";

/** A feature phone talking to the SVX number through the emulated GSM network. */
async function setup() {
  const db = await createTestDb();
  const deps = { db, events: createEventBus(), transport: createTransport("emulator", { db }) };
  return {
    db,
    /** The phone sends `body`; returns the texts the server sent back, oldest first. */
    async text(body: string, from = PHONE, receivedAt?: Date) {
      const before = (await listOutbox(db)).length;
      await receiveSms(deps, { from, body, emulated: true, receivedAt });
      const outbox = await listOutbox(db);
      return outbox.slice(0, outbox.length - before).reverse().map((sms) => sms.body);
    },
    incidents: () => listIncidents(db),
    incident: (id: string) => getIncident(db, id),
    wire: () => listWireLog(db),
  };
}

describe("feature-phone SMS menu", () => {
  it("answers ACCIDENT with the first question, without opening an incident yet", async () => {
    const phone = await setup();

    const replies = await phone.text("ACCIDENT");

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/victimes/i);
    expect(await phone.incidents()).toHaveLength(0);
  });

  it("walks through victims, conscious, danger and commune, then opens one emulated incident located in that commune", async () => {
    const phone = await setup();

    expect((await phone.text("ACCIDENT"))[0]).toMatch(/victimes/i);
    expect((await phone.text("3"))[0]).toMatch(/conscients/i);
    expect((await phone.text("1"))[0]).toMatch(/danger/i);
    expect((await phone.text("3"))[0]).toMatch(/commune/i); // 3 = fire and trapped
    const last = await phone.text("Bab Ezzouar");

    expect(last).toHaveLength(1);
    expect(last[0]).toMatch(/^SVXACK#[0-9A-F]{8}$/);

    const incidents = await phone.incidents();
    expect(incidents).toHaveLength(1);
    const incident = incidents[0]!;
    expect(incident).toMatchObject({ commune: "Bab Ezzouar", emulated: true, estimatedVictims: 3, alertCount: 1 });
    expect(incident.lat).toBeCloseTo(36.7255, 2);
    expect(incident.lng).toBeCloseTo(3.1836, 2);
    expect(incident.locationUncertaintyM).toBeGreaterThanOrEqual(500); // a commune, not an exact spot

    const { alerts } = (await phone.incident(incident.id))!;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      channel: "sms",
      source: "ussd",
      emulated: true,
      victims: 3,
      conscious: 1,
      fire: true,
      trapped: true,
    });
  });

  it("returns the texts it sent back, so the caller (gateway, console) can show them", async () => {
    const db = await createTestDb();
    const deps = { db, events: createEventBus(), transport: createTransport("emulator", { db }) };

    const first = await receiveSms(deps, { from: PHONE, body: "ACCIDENT", emulated: true });

    expect(first).toMatchObject({ kind: "menu", replies: [expect.stringMatching(/victimes/i)] });
    const outbox = await listOutbox(db);
    expect(outbox.map((sms) => sms.body)).toEqual(first.kind === "menu" ? first.replies : []);
  });

  it("asks the same question again after an answer that makes no sense", async () => {
    const phone = await setup();
    await phone.text("ACCIDENT");

    expect((await phone.text("beaucoup"))[0]).toMatch(/invalide.*victimes/i);
    await phone.text("2");
    expect((await phone.text("5"))[0]).toMatch(/invalide.*conscients/i); // more conscious than victims
    await phone.text("1");
    expect((await phone.text("9"))[0]).toMatch(/invalide.*danger/i);
    expect(await phone.incidents()).toHaveLength(0);
  });

  it("keeps asking for the place until it knows it, and opens no incident meanwhile", async () => {
    const phone = await setup();
    for (const answer of ["ACCIDENT", "1", "1", "0"]) await phone.text(answer);

    expect((await phone.text("Tamanrasset"))[0]).toMatch(/inconnu.*commune/i);
    expect(await phone.incidents()).toHaveLength(0);
    expect((await phone.text("Rouiba"))[0]).toMatch(/^SVXACK#/);
    expect(await phone.incidents()).toHaveLength(1);
  });

  it("does not answer a phone that has no conversation going: its text is handled like any other SMS", async () => {
    const phone = await setup();

    expect(await phone.text("2")).toEqual([]);
    expect(await phone.incidents()).toHaveLength(0);
    expect(await phone.wire()).toHaveLength(1); // still on record (never drop a signal)
  });

  it("keeps two phones' conversations apart", async () => {
    const phone = await setup();
    await phone.text("ACCIDENT", "+213550000001");
    await phone.text("ACCIDENT", "+213550000002");
    await phone.text("4", "+213550000001");

    expect((await phone.text("1", "+213550000002"))[0]).toMatch(/conscients/i); // 2nd phone still on question 1
    expect((await phone.text("2", "+213550000001"))[0]).toMatch(/danger/i); // 1st phone moved on
  });

  it("restarts from the first question when the phone sends ACCIDENT again", async () => {
    const phone = await setup();
    await phone.text("ACCIDENT");
    await phone.text("3");
    expect((await phone.text("accident"))[0]).toMatch(/victimes/i);
  });

  it("forgets a conversation left unanswered for 15 minutes: a late answer is just an SMS", async () => {
    const phone = await setup();
    const start = new Date("2026-10-30T10:00:00Z");
    await phone.text("ACCIDENT", PHONE, start);

    expect(await phone.text("3", PHONE, new Date(start.getTime() + 16 * 60_000))).toEqual([]);
  });

  it("speaks Arabic to a phone that texted حادث, and understands Arabic digits and commune names", async () => {
    const phone = await setup();

    expect((await phone.text("حادث"))[0]).toMatch(/الضحايا/);
    expect((await phone.text("٢"))[0]).toMatch(/واعون/);
    await phone.text("١");
    await phone.text("٠");
    expect((await phone.text("باب الزوار"))[0]).toMatch(/^SVXACK#/);

    const [incident] = await phone.incidents();
    expect(incident).toMatchObject({ commune: "Bab Ezzouar", estimatedVictims: 2 });
  });

  it("records a road kilometre point on the incident when the caller gives one", async () => {
    const phone = await setup();
    for (const answer of ["ACCIDENT", "1", "1", "0", "RN5 PK 12"]) await phone.text(answer);

    const [incident] = await phone.incidents();
    expect(incident).toMatchObject({ roadRef: "RN5", pkMarker: "PK 12", commune: null });
    expect(incident!.locationUncertaintyM).toBeLessThan(1_500);
  });

  it("puts every message of the conversation on the wire log as emulated, and never stores the phone number", async () => {
    const phone = await setup();
    for (const answer of ["ACCIDENT", "1", "1", "0", "Rouiba"]) await phone.text(answer);

    const wire = await phone.wire();
    expect(wire.filter((sms) => sms.direction === "in")).toHaveLength(5);
    expect(wire.filter((sms) => sms.direction === "out")).toHaveLength(5);
    expect(wire.every((sms) => sms.emulated)).toBe(true);
    expect(JSON.stringify(wire)).not.toContain(PHONE);
  });
});
