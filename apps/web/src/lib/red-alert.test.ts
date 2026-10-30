import { describe, expect, it } from "vitest";

import {
  detectNewRedIncident,
  type IncidentSummary,
  createTitleFlasher,
} from "./red-alert";

describe("detectNewRedIncident (FR-S5-07)", () => {
  it("returns null when incident list is initial / empty", () => {
    expect(detectNewRedIncident([], [])).toBeNull();
  });

  it("detects a brand new RED incident", () => {
    const prev: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "yellow" },
    ];
    const curr: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "yellow" },
      { id: "inc-2", recSeverity: "red" },
    ];
    const detected = detectNewRedIncident(prev, curr);
    expect(detected).toEqual({ id: "inc-2", recSeverity: "red" });
  });

  it("detects when an existing incident escalates to RED", () => {
    const prev: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "yellow" },
    ];
    const curr: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "red" },
    ];
    const detected = detectNewRedIncident(prev, curr);
    expect(detected).toEqual({ id: "inc-1", recSeverity: "red" });
  });

  it("does not trigger for new green or yellow incidents", () => {
    const prev: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "green" },
    ];
    const curr: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "green" },
      { id: "inc-2", recSeverity: "yellow" },
    ];
    expect(detectNewRedIncident(prev, curr)).toBeNull();
  });

  it("does not re-trigger for existing known red incidents", () => {
    const prev: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "red" },
    ];
    const curr: IncidentSummary[] = [
      { id: "inc-1", recSeverity: "red" },
    ];
    expect(detectNewRedIncident(prev, curr)).toBeNull();
  });
});

describe("createTitleFlasher", () => {
  it("alternates document title until stopped", () => {
    let title = "SVX Rescue";
    const setTitle = (t: string) => {
      title = t;
    };

    const flasher = createTitleFlasher({
      baseTitle: "SVX Rescue",
      alertTitle: "🚨 ALERTE ROUGE - SVX Rescue",
      setTitle,
    });

    flasher.step();
    expect(title).toBe("🚨 ALERTE ROUGE - SVX Rescue");

    flasher.step();
    expect(title).toBe("SVX Rescue");

    flasher.step();
    expect(title).toBe("🚨 ALERTE ROUGE - SVX Rescue");

    flasher.stop();
    expect(title).toBe("SVX Rescue");
  });
});
