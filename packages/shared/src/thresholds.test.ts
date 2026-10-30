import { describe, expect, it } from "vitest";

import vectors from "../test-vectors/svx.json";
import { THRESHOLDS } from "./thresholds";

describe("THRESHOLDS", () => {
  it("matches the shared reference in test-vectors/svx.json (no drift between code and spec)", () => {
    const { $comment: _comment, ...reference } = vectors.thresholds;
    expect(THRESHOLDS).toEqual(reference);
  });

  it("keeps the values the PRD fixes (FR-S2-01)", () => {
    expect(THRESHOLDS.phoneTrigger).toMatchObject({ peakG: 4, speedBeforeKmh: 25, speedAfterKmh: 5 });
    expect(THRESHOLDS.chipTrigger).toMatchObject({ peakG: 6, minDurationMs: 3 });
    expect(THRESHOLDS.vittelL2HighEnergy).toEqual({ peakG: 4, deltaVKmh: 30 });
    expect(THRESHOLDS.rollover).toEqual({ angleDeg: 90, minDurationS: 2 });
    expect(THRESHOLDS.cluster).toEqual({ windowMin: 10, baseDistanceM: 200, uncertaintyCapM: 3000 });
  });
});
