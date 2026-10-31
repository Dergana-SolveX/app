import { describe, expect, it } from "vitest";

import { createTitleFlasher, detectArrivals, type ArrivalSnapshot } from "./alert-sound";

const inc = (id: string, recSeverity: string, alertCount = 1): ArrivalSnapshot => ({ id, recSeverity, alertCount });

describe("detectArrivals", () => {
  it("ignores the first snapshot after loading", () => {
    expect(detectArrivals([], [inc("a", "red")], false)).toEqual([]);
  });

  it("reports every new incident, whatever its severity", () => {
    expect(detectArrivals([inc("a", "green")], [inc("a", "green"), inc("b", "yellow"), inc("c", "unknown")])).toEqual([
      { id: "b", recSeverity: "yellow", kind: "new" },
      { id: "c", recSeverity: "unknown", kind: "new" },
    ]);
  });

  it("reports a new alert merged into a known incident", () => {
    expect(detectArrivals([inc("a", "yellow", 1)], [inc("a", "yellow", 2)])).toEqual([
      { id: "a", recSeverity: "yellow", kind: "signal" },
    ]);
  });

  it("reports an escalation to RED without a new alert", () => {
    expect(detectArrivals([inc("a", "yellow")], [inc("a", "red")])).toEqual([
      { id: "a", recSeverity: "red", kind: "escalated" },
    ]);
  });

  it("stays silent when nothing arrived", () => {
    expect(detectArrivals([inc("a", "red", 2)], [inc("a", "red", 2)])).toEqual([]);
    expect(detectArrivals([inc("a", "red", 2), inc("b", "green")], [inc("a", "red", 2)])).toEqual([]);
  });
});

describe("createTitleFlasher", () => {
  it("alternates the tab title until stopped", () => {
    let title = "AWN";
    const flasher = createTitleFlasher({ baseTitle: "AWN", alertTitle: "Nouvelle alerte — AWN", setTitle: (t) => (title = t) });
    flasher.step();
    expect(title).toBe("Nouvelle alerte — AWN");
    flasher.step();
    expect(title).toBe("AWN");
    flasher.step();
    flasher.stop();
    expect(title).toBe("AWN");
  });
});
