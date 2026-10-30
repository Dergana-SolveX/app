import { describe, expect, it } from "vitest";

import type { SensorSample } from "./detect";
import { createChip, type ChipRecord } from "./machine";

const idle = (tMs: number, over: Partial<SensorSample> = {}): SensorSample => ({
  tMs, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, smoke: 0, flame: false, ...over,
});
const types = (records: ChipRecord[]) => records.map((r) => r.type);
const changes = (records: ChipRecord[]) =>
  records.filter((r) => r.type === "state_change").map((r) => `${r.data.from}>${r.data.to}`);
const sends = (records: ChipRecord[]) => records.filter((r) => r.type === "http_sent" || r.type === "sms_sent");

/** A chip that has booted and is armed, with the clock at 1200 ms. */
function armedChip(options: Parameters<typeof createChip>[0] = {}) {
  const chip = createChip(options);
  chip.advance(1000);
  chip.press("arm", 1200);
  return chip;
}

/** `ms` samples of `g` along x starting at `atMs`, then one quiet sample: the pulse is closed at atMs + ms. */
function crash(chip: ReturnType<typeof createChip>, atMs: number, g: number, ms: number) {
  const records: ChipRecord[] = [];
  for (let t = atMs; t < atMs + ms; t++) records.push(...chip.sample(idle(t, { ax: -g })));
  records.push(...chip.sample(idle(atMs + ms)));
  return records;
}

describe("chip state machine: BOOT -> IDLE <-> ARMED -> IMPACT -> CONFIRM -> SEND -> AWAIT_ACK -> DONE", () => {
  it("boots, runs its self-test for 1 s, and goes idle", () => {
    const chip = createChip();
    expect(chip.state).toBe("BOOT");
    expect(chip.advance(999)).toEqual([]);
    expect(chip.state).toBe("BOOT");
    const records = chip.advance(1000);
    expect(changes(records)).toEqual(["BOOT>IDLE"]);
    expect(types(records)).toContain("selftest");
    expect(chip.state).toBe("IDLE");
  });

  it("is armed and disarmed by the button, but not while booting", () => {
    const chip = createChip();
    expect(chip.press("arm", 500)).toEqual([]);
    expect(chip.state).toBe("BOOT");
    chip.advance(1000);
    expect(changes(chip.press("arm", 1100))).toEqual(["IDLE>ARMED"]);
    expect(changes(chip.press("disarm", 1200))).toEqual(["ARMED>IDLE"]);
    expect(chip.press("disarm", 1300)).toEqual([]);
  });

  it("does not react to a crash while it is not armed (PRD chip_trigger: ARMED required)", () => {
    const chip = createChip();
    chip.advance(1000);
    const records = crash(chip, 2000, 20, 10);
    expect(records).toEqual([]);
    expect(chip.state).toBe("IDLE");
  });

  it("says nothing about a pulse that is too short while it is not armed", () => {
    const chip = createChip();
    chip.advance(1000);
    expect(crash(chip, 2000, 20, 2)).toEqual([]);
    expect(chip.state).toBe("IDLE");
  });

  it("goes through IMPACT to CONFIRM on a crash, and starts a 10 s countdown", () => {
    const chip = armedChip();
    const records = crash(chip, 2000, 20, 10);
    expect(changes(records)).toEqual(["ARMED>IMPACT", "IMPACT>CONFIRM"]);
    expect(types(records)).toContain("impact_detected");
    expect(chip.state).toBe("CONFIRM");
    expect(chip.confirmRemainingMs(2010)).toBe(10_000);
    expect(chip.confirmRemainingMs(7010)).toBe(5_000);
    expect(chip.confirmRemainingMs(99_999)).toBe(0);
  });

  it("describes the impact it detected", () => {
    const chip = armedChip();
    const impact = crash(chip, 2000, 20, 10).find((r) => r.type === "impact_detected")!;
    expect(impact.data).toMatchObject({ cause: "impact", impacts: 1, saturated: false });
    expect(impact.data.peakG).toBeCloseTo(Math.hypot(20, 1), 3);
  });

  it("sends nothing before the 10 s are over, then sends once", () => {
    const chip = armedChip();
    crash(chip, 2000, 20, 10);
    expect(sends(chip.advance(12_009))).toEqual([]);
    expect(chip.state).toBe("CONFIRM");
    const records = chip.advance(12_010);
    expect(changes(records)).toEqual(["CONFIRM>SEND", "SEND>AWAIT_ACK"]);
    const [sent] = sends(records);
    expect(sent).toMatchObject({ type: "http_sent", tMs: 12_010 });
    expect(sent!.data).toMatchObject({ attempt: 1 });
    expect(sent!.data.packet).toMatchObject({ impacts: 1, cause: "impact", rollover: false, fire: false, eventMs: 2000 });
    expect(chip.state).toBe("AWAIT_ACK");
  });

  it("cancels a false alarm during CONFIRM: back to ARMED, nothing is ever sent", () => {
    const chip = armedChip();
    crash(chip, 2000, 20, 10);
    const records = chip.press("cancel", 5000);
    expect(types(records)).toContain("cancel_pressed");
    expect(changes(records)).toEqual(["CONFIRM>ARMED"]);
    expect(sends(chip.advance(60_000))).toEqual([]);
    expect(chip.state).toBe("ARMED");
  });

  it("can detect a second crash after a cancel", () => {
    const chip = armedChip();
    crash(chip, 2000, 20, 10);
    chip.press("cancel", 5000);
    crash(chip, 8000, 25, 10);
    expect(chip.state).toBe("CONFIRM");
    expect(sends(chip.advance(18_010))).toHaveLength(1);
  });

  it("ignores the cancel button once the alert has gone out", () => {
    const chip = armedChip();
    crash(chip, 2000, 20, 10);
    chip.advance(12_010);
    expect(chip.press("cancel", 13_000)).toEqual([]);
    expect(chip.state).toBe("AWAIT_ACK");
  });

  it("goes to DONE when the server answers, and sends no more", () => {
    const chip = armedChip();
    crash(chip, 2000, 20, 10);
    chip.advance(12_010);
    const records = chip.ack(12_500);
    expect(changes(records)).toEqual(["AWAIT_ACK>DONE"]);
    expect(types(records)).toContain("ack_received");
    expect(chip.state).toBe("DONE");
    expect(sends(chip.advance(120_000))).toEqual([]);
  });

  it("ignores an answer it was not waiting for", () => {
    const chip = armedChip();
    expect(chip.ack(2000)).toEqual([]);
    expect(chip.state).toBe("ARMED");
  });

  it("counts repeated impacts during CONFIRM as one event", () => {
    const chip = armedChip();
    crash(chip, 2000, 20, 10);
    crash(chip, 5000, 30, 20);
    const [sent] = sends(chip.advance(12_010));
    expect(sent!.data.packet).toMatchObject({ impacts: 2, saturated: false, eventMs: 2000 });
    expect((sent!.data.packet as { peakG: number }).peakG).toBeCloseTo(Math.hypot(30, 1), 3);
  });

  it("filters a pulse that is too short, and stays armed", () => {
    const chip = armedChip();
    const records = crash(chip, 2000, 20, 2);
    expect(records.map((r) => r.type)).toEqual(["impact_rejected"]);
    expect(records[0]!.data).toMatchObject({ reason: "filtré : durée < 3 ms" });
    expect(chip.state).toBe("ARMED");
    expect(sends(chip.advance(60_000))).toEqual([]);
  });

  it("flags a saturated pulse in what it sends", () => {
    const chip = armedChip();
    crash(chip, 2000, 250, 10);
    const [sent] = sends(chip.advance(12_010));
    expect(sent!.data.packet).toMatchObject({ saturated: true });
  });

  it("can be reset to BOOT at any time", () => {
    const chip = armedChip();
    crash(chip, 2000, 20, 10);
    const records = chip.reset(3000);
    expect(changes(records)).toEqual(["CONFIRM>BOOT"]);
    expect(chip.state).toBe("BOOT");
    expect(sends(chip.advance(60_000))).toEqual([]);
    expect(chip.state).toBe("IDLE");
  });
});

describe("AWAIT_ACK: backoff and switching channel (PRD FR-S8-02)", () => {
  /** A chip that has just sent its first attempt at 12010 ms. */
  function awaiting(options: Parameters<typeof createChip>[0] = {}) {
    const chip = armedChip(options);
    crash(chip, 2000, 20, 10);
    const first = sends(chip.advance(12_010));
    return { chip, first };
  }

  it("tries again 3 s after a failure, then 6 s, 12 s, then every 30 s", () => {
    const { chip, first } = awaiting();
    expect(first[0]!.type).toBe("http_sent");
    // Each failure is reported 1 s after the attempt; the next attempt follows after the backoff.
    const attempts: { tMs: number; type: string }[] = [{ tMs: first[0]!.tMs, type: first[0]!.type }];
    let clock = first[0]!.tMs;
    for (let n = 0; n < 5; n++) {
      clock += 1000;
      chip.advance(clock);
      chip.sendFailed(clock);
      const wait = [3000, 6000, 12_000, 30_000, 30_000][n]!;
      expect(sends(chip.advance(clock + wait - 1))).toEqual([]);
      const next = sends(chip.advance(clock + wait));
      expect(next).toHaveLength(1);
      clock += wait;
      attempts.push({ tMs: next[0]!.tMs, type: next[0]!.type });
    }
    expect(attempts.map((a) => a.tMs)).toEqual([12_010, 16_010, 23_010, 36_010, 67_010, 98_010]);
  });

  it("sends by the web twice, then switches to SMS (PRD: channel switch)", () => {
    const { chip, first } = awaiting();
    const channels = [first[0]!.type];
    let clock = first[0]!.tMs;
    for (const wait of [3000, 6000, 12_000]) {
      chip.sendFailed(clock);
      clock += wait;
      channels.push(sends(chip.advance(clock))[0]!.type);
    }
    expect(channels).toEqual(["http_sent", "http_sent", "sms_sent", "sms_sent"]);
  });

  it("counts a silent server as a failure after 10 s, then waits the 3 s backoff", () => {
    const { chip } = awaiting();
    // Sent at 12010; no answer; the timeout hits at 22010; the second attempt follows 3 s later, at 25010.
    expect(sends(chip.advance(25_009))).toEqual([]);
    expect(chip.state).toBe("AWAIT_ACK");
    const retry = sends(chip.advance(25_010));
    expect(retry).toHaveLength(1);
    expect(retry[0]!.data).toMatchObject({ attempt: 2 });
  });

  it("answers on a later attempt: DONE, with the original event time still in the packet", () => {
    const { chip } = awaiting();
    chip.sendFailed(13_000);
    const [retry] = sends(chip.advance(16_000));
    expect((retry!.data.packet as { eventMs: number }).eventMs).toBe(2000);
    expect(changes(chip.ack(16_400))).toEqual(["AWAIT_ACK>DONE"]);
  });

  it("zone blanche: goes straight to SMS and never uses the web", () => {
    const chip = armedChip({ forceSms: true });
    crash(chip, 2000, 20, 10);
    const [sent] = sends(chip.advance(12_010));
    expect(sent!.type).toBe("sms_sent");
    chip.sendFailed(13_000);
    expect(sends(chip.advance(16_000))[0]!.type).toBe("sms_sent");
  });
});
