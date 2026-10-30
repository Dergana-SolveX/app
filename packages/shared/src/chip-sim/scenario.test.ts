import { describe, expect, it } from "vitest";

import type { ChipRecord } from "./machine";
import { runScenario } from "./scenario";
import { customTrace, generateTrace } from "./traces";

const changes = (records: ChipRecord[]) =>
  records.filter((r) => r.type === "state_change").map((r) => `${r.data.from}>${r.data.to}`);
const sends = (records: ChipRecord[]) => records.filter((r) => r.type === "http_sent" || r.type === "sms_sent");
const first = (records: ChipRecord[], type: ChipRecord["type"]) => records.find((r) => r.type === type)!;

/** The chip boots at 0, is armed at 1200 ms, and the trace starts at 2000 ms. */
const START = 2000;

describe("runScenario: a trace played through the chip and a seeded network", () => {
  it("frontal_40 goes the whole way: BOOT to DONE, one event on the web", () => {
    const run = runScenario(generateTrace("frontal_40", { seed: 1 }), { seed: 1 });
    expect(changes(run.records)).toEqual([
      "BOOT>IDLE", "IDLE>ARMED", "ARMED>IMPACT", "IMPACT>CONFIRM", "CONFIRM>SEND", "SEND>AWAIT_ACK", "AWAIT_ACK>DONE",
    ]);
    expect(run.state).toBe("DONE");
    expect(sends(run.records).map((r) => r.type)).toEqual(["http_sent"]);
    expect(run.packet).toMatchObject({ cause: "impact", impacts: 1, saturated: false, rollover: false, fire: false });
    expect(run.packet!.peakG).toBeGreaterThan(25);
    expect(run.packet!.peakG).toBeLessThan(36);
    expect(run.packet!.deltaVKmh).toBeGreaterThan(30);
  });

  it("waits exactly the 10 s of the countdown between the impact and the send", () => {
    const run = runScenario(generateTrace("frontal_40", { seed: 1 }), { seed: 1 });
    const detected = first(run.records, "impact_detected").tMs;
    expect(first(run.records, "http_sent").tMs - detected).toBe(10_000);
    // The pulse begins 500 ms into the trace; the chip dates it from the moment it crosses 6 g, a few ms later.
    expect(run.packet!.eventMs).toBeGreaterThanOrEqual(START + 500);
    expect(run.packet!.eventMs).toBeLessThan(START + 520);
  });

  it("pothole: rejected as too short, the chip stays armed and sends nothing", () => {
    const run = runScenario(generateTrace("pothole", { seed: 1 }), { seed: 1 });
    expect(sends(run.records)).toEqual([]);
    const rejected = first(run.records, "impact_rejected");
    expect(rejected.data).toMatchObject({ reason: "filtré : durée < 3 ms" });
    expect(run.state).toBe("ARMED");
    expect(run.packet).toBeNull();
  });

  it("rollover: starts with no g-spike, about 2 s after the car passes 90 degrees", () => {
    const run = runScenario(generateTrace("rollover", { seed: 1 }), { seed: 1 });
    expect(run.packet).toMatchObject({ cause: "rollover", impacts: 0, rollover: true, fire: false });
    expect(run.packet!.rolloverDeg).toBeGreaterThanOrEqual(170);
    const detected = first(run.records, "impact_detected").tMs;
    // The car passes 90 degrees at 1750 ms into the trace; 2 s later it counts as over.
    expect(detected - START).toBeGreaterThan(3600);
    expect(detected - START).toBeLessThan(4000);
    expect(run.state).toBe("DONE");
  });

  it("fire_parked: starts with no g-spike, after smoke and flame have held for 3 s", () => {
    const run = runScenario(generateTrace("fire_parked", { seed: 1 }), { seed: 1 });
    expect(run.packet).toMatchObject({ cause: "fire", impacts: 0, fire: true, rollover: false });
    const detected = first(run.records, "impact_detected").tMs - START;
    expect(detected).toBeGreaterThan(5500);
    expect(detected).toBeLessThan(5900);
    // The fire is dated from when it began, not from when the 3 s were up.
    expect(run.packet!.eventMs - START).toBeGreaterThan(2500);
    expect(run.packet!.eventMs - START).toBeLessThan(3000);
  });

  it("a crash followed by a fire is one event that says both", () => {
    const run = runScenario(customTrace({ peakG: 40, durationMs: 60, rollDeg: 0, fire: true }, { seed: 1 }), { seed: 1 });
    expect(run.packet).toMatchObject({ cause: "impact", impacts: 1, fire: true });
    expect(sends(run.records)).toHaveLength(1);
  });

  it("repeated impacts become one event with the count, the highest peak and the Delta-V added up", () => {
    const trace = generateTrace("frontal_40", { seed: 1 });
    for (let i = 1500; i < 1530; i++) trace.samples[i]!.ax -= 40; // a second hit one second after the first
    const run = runScenario(trace, { seed: 1 });
    expect(sends(run.records)).toHaveLength(1);
    expect(run.packet!.impacts).toBe(2);
    expect(run.packet!.peakG).toBeGreaterThan(40);
    // The second hit is 40 g for 30 ms: 40 x 9.80665 x 0.030 x 3.6 = 42.4 km/h on top of the first one's.
    const single = runScenario(generateTrace("frontal_40", { seed: 1 }), { seed: 1 }).packet!.deltaVKmh;
    expect(run.packet!.deltaVKmh - single).toBeGreaterThan(40.4);
    expect(run.packet!.deltaVKmh - single).toBeLessThan(44.4);
  });

  it("flags a pulse beyond what the sensor can read", () => {
    const run = runScenario(customTrace({ peakG: 400, durationMs: 40, rollDeg: 0, fire: false }, { seed: 1 }), { seed: 1 });
    expect(run.packet).toMatchObject({ saturated: true, impacts: 1 });
    expect(run.packet!.peakG).toBeGreaterThanOrEqual(200);
  });

  it("zone blanche: every attempt goes by SMS, none by the web", () => {
    const run = runScenario(generateTrace("frontal_40", { seed: 1 }), { seed: 1, forceSms: true });
    expect(sends(run.records).map((r) => r.type)).toEqual(["sms_sent"]);
    expect(run.state).toBe("DONE");
    expect(run.packet).toMatchObject({ cause: "impact", impacts: 1 });
  });

  it("a web outage: two web attempts fail, then it switches to SMS and gets through", () => {
    const run = runScenario(generateTrace("frontal_40", { seed: 1 }), { seed: 1, httpFailures: 2 });
    const attempts = sends(run.records);
    expect(attempts.map((r) => r.type)).toEqual(["http_sent", "http_sent", "sms_sent"]);
    // Each wait is the failure delay (0.5-1.5 s) plus the backoff, 3 s then 6 s.
    expect(attempts[1]!.tMs - attempts[0]!.tMs).toBeGreaterThanOrEqual(3500);
    expect(attempts[1]!.tMs - attempts[0]!.tMs).toBeLessThanOrEqual(4500);
    expect(attempts[2]!.tMs - attempts[1]!.tMs).toBeGreaterThanOrEqual(6500);
    expect(attempts[2]!.tMs - attempts[1]!.tMs).toBeLessThanOrEqual(7500);
    expect(run.state).toBe("DONE");
    // The packet keeps the time of the crash through every retry.
    expect(new Set(attempts.map((r) => (r.data.packet as { eventMs: number }).eventMs)).size).toBe(1);
  });

  it("is exactly the same twice for the same seeds, and differs when the network seed differs", () => {
    const trace = generateTrace("frontal_40", { seed: 9 });
    const a = runScenario(trace, { seed: 3, httpFailures: 1 });
    const b = runScenario(generateTrace("frontal_40", { seed: 9 }), { seed: 3, httpFailures: 1 });
    expect(b.records).toEqual(a.records);
    const other = runScenario(trace, { seed: 4, httpFailures: 1 });
    expect(other.records).not.toEqual(a.records);
    expect(changes(other.records)).toEqual(changes(a.records));
  });
});
