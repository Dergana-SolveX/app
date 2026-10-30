import { describe, expect, it } from "vitest";
import { formatDegrees, getVehicleTwinStatus, isImpactingNow } from "./vehicle-twin";

describe("3D vehicle twin logic (FR-S8-08)", () => {
  it("formats roll and pitch angles cleanly with sign and degree unit", () => {
    expect(formatDegrees(0)).toBe("0.0°");
    expect(formatDegrees(12.34)).toBe("+12.3°");
    expect(formatDegrees(-45.67)).toBe("-45.7°");
  });

  it("determines vehicle twin status based on roll and pitch", () => {
    expect(getVehicleTwinStatus({ rollDeg: 0, pitchDeg: 0 })).toBe("STABLE");
    expect(getVehicleTwinStatus({ rollDeg: 25, pitchDeg: 5 })).toBe("INCLINÉ");
    expect(getVehicleTwinStatus({ rollDeg: 95, pitchDeg: 0 })).toBe("TONNEAU");
    expect(getVehicleTwinStatus({ rollDeg: 0, pitchDeg: -92 })).toBe("TONNEAU");
  });

  it("determines whether the vehicle is actively flashing from impact", () => {
    // IMPACT state always flashes
    expect(isImpactingNow("IMPACT", 0, null)).toBe(true);

    // Recent impact event within 800ms flashes
    expect(isImpactingNow("CONFIRM", 1000, 500)).toBe(true); // 500ms ago

    // Old impact event (>800ms ago) does not flash
    expect(isImpactingNow("CONFIRM", 2000, 500)).toBe(false); // 1500ms ago

    // Outside impact/confirm without recent impact does not flash
    expect(isImpactingNow("ARMED", 1000, null)).toBe(false);
  });
});
