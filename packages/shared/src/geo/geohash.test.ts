import { describe, expect, it } from "vitest";

import { decodeGeohash } from "./geohash";

describe("decodeGeohash (FR-S2-07)", () => {
  it("decodes the reference examples to their cell centre", () => {
    // Reference values from the geohash specification examples (Wikipedia).
    const spain = decodeGeohash("ezs42");
    expect(spain?.lat).toBeCloseTo(42.6, 1);
    expect(spain?.lng).toBeCloseTo(-5.6, 1);

    const denmark = decodeGeohash("u4pruydqqvj");
    expect(denmark?.lat).toBeCloseTo(57.64911, 5);
    expect(denmark?.lng).toBeCloseTo(10.40744, 5);
  });

  it("reports the cell half-size as the position uncertainty", () => {
    const eight = decodeGeohash("u4pruydq");
    // A precision-8 cell is about 38 m x 19 m, so the centre is within ~25 m.
    expect(eight?.errorM).toBeGreaterThan(10);
    expect(eight?.errorM).toBeLessThan(40);
  });

  it("rejects text that is not a geohash", () => {
    expect(decodeGeohash("")).toBeNull();
    expect(decodeGeohash("ailo")).toBeNull();
  });
});
