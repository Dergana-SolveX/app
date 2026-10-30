import { describe, expect, it } from "vitest";

import { assessVictim } from "./assess";

const NOW = new Date("2026-10-30T12:00:00Z");
const elderly = {
  birthDate: "1950-01-01",
  pregnancy: "none" as const,
  medications: [
    { name: "Sintrom", class: "anticoagulant" },
    { name: "Bisoprolol", class: "beta_blocker" },
  ],
};

describe("assessVictim: the one computation the tablet and the server both run", () => {
  it("gives nothing severe and no Shock Index for a victim with nothing recorded", () => {
    const result = assessVictim({ now: NOW });
    expect(result.vittel).toEqual({ severe: false, positives: [] });
    expect(result.shockIndex).toBeNull();
    expect(result.age).toBeNull();
  });

  it("uses the registered profile for age, level 5 and the Shock Index caveats", () => {
    const result = assessVictim({ now: NOW, profile: elderly, vitals: { hr: 80, sbp: 120 } });
    expect(result.age).toBe(76);
    expect(result.vittel.positives.map((p) => p.id)).toEqual(["ageOver65", "coagulationDisorder"]);
    expect(result.shockIndex!.caveats).toEqual(["peut sous-estimer le choc"]);
  });

  it("falls back on the estimated age when there is no profile", () => {
    expect(assessVictim({ now: NOW, estAge: 80 }).vittel.positives.map((p) => p.id)).toEqual(["ageOver65"]);
    expect(assessVictim({ now: NOW, estAge: 65 }).vittel.severe).toBe(false);
    expect(assessVictim({ now: NOW, estAge: 8, vitals: { hr: 110, sbp: 100 } }).shockIndex!.caveats).toEqual([
      "seuils adultes non applicables",
    ]);
  });

  it("computes level 1 from the measures, and never lets a ticked level-1 answer overrule a measure", () => {
    const result = assessVictim({
      now: NOW,
      vitals: { gcs: 15, sbp: 120 },
      medic: { l1: { gcsLow: { value: true, source: "medic" } } },
    });
    expect(result.vittel.severe).toBe(false);
    expect(result.state.l1.gcsLow).toEqual({ value: false, source: "medic" });
  });

  it("keeps the sensor prefill until the medic overrules it", () => {
    const sensors = { l2: { rollover: { value: true, source: "iot" as const } } };
    expect(assessVictim({ now: NOW, sensors }).vittel.positives.map((p) => p.id)).toEqual(["rollover"]);
    const overruled = assessVictim({ now: NOW, sensors, medic: { l2: { rollover: { value: false, source: "medic" } } } });
    expect(overruled.vittel.severe).toBe(false);
  });
});
