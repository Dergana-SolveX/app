import { describe, expect, it } from "vitest";

import { profileRisk } from "./profileRisk";

describe("profileRisk (FR-S2-18)", () => {
  it("an anticoagulant makes the profile HIGH with the internal-bleeding flag and a coagulation prep tag", () => {
    const result = profileRisk({ medications: [{ name: "Sintrom", class: "anticoagulant" }] });

    expect(result.level).toBe("high");
    expect(result.flags).toContain("risque hémorragique interne");
    expect(result.prepTags).toContain("bilan de coagulation / antidote");
  });

  it("insulin adds a capillary glucose tag without raising the level", () => {
    const result = profileRisk({ medications: [{ name: "Lantus", class: "insulin" }] });

    expect(result.level).toBe("normal");
    expect(result.prepTags).toContain("glycémie capillaire");
  });

  it("lists allergies verbatim and asks to prepare blood for the blood type", () => {
    const result = profileRisk({ allergies: ["pénicilline", "latex"], bloodType: "A+" });

    expect(result.flags).toContain("Allergie : pénicilline");
    expect(result.flags).toContain("Allergie : latex");
    expect(result.prepTags).toContain("préparer culots A+ / O−");
  });

  it("a beta-blocker warns that the shock index is unreliable", () => {
    const result = profileRisk({ medications: [{ name: "Bisoprolol", class: "beta_blocker" }] });

    expect(result.flags).toContain("SI peu fiable");
  });

  it("no profile data gives a normal level and nothing to prepare", () => {
    expect(profileRisk({})).toEqual({ level: "normal", flags: [], prepTags: [] });
  });
});
