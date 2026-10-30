import { describe, expect, it } from "vitest";

import { routeAuthority, type UrbanZone } from "./routeAuthority";

const box = (w: number, s: number, e: number, n: number): UrbanZone => ({
  name: "Alger-Centre",
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  },
});
const zones = [box(3.03, 36.75, 3.08, 36.79)];

describe("routeAuthority (FR-S2-19)", () => {
  it("inside an urban perimeter it is the Sûreté Nationale (17 / 1548)", () => {
    const result = routeAuthority(36.77, 3.06, zones);

    expect(result?.authority).toBe("surete_nationale");
    expect(result?.phones).toEqual(["17", "1548"]);
    expect(result?.reason).toContain("Alger-Centre");
  });

  it("outside every perimeter it is the Gendarmerie Nationale (1055)", () => {
    const result = routeAuthority(36.6, 3.4, zones, "A1");

    expect(result?.authority).toBe("gendarmerie_nationale");
    expect(result?.phones).toEqual(["1055"]);
  });

  it("a national road inside a perimeter stays with the Sûreté", () => {
    expect(routeAuthority(36.77, 3.06, zones, "RN5")?.authority).toBe("surete_nationale");
  });

  it("without a position there is no recommendation", () => {
    expect(routeAuthority(null, null, zones)).toBeNull();
  });
});
