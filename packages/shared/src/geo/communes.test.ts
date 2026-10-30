import { describe, expect, it } from "vitest";

import { haversineM } from "./distance";
import { geocodeCommune, geocodeLocation, listCommunes } from "./communes";

// Reference positions are well-known landmarks, written as literals (not derived from the table).
const BAB_EZZOUAR = { lat: 36.7255, lng: 3.1836 };
const BAB_EL_OUED = { lat: 36.7897, lng: 3.0514 };

describe("geocodeCommune", () => {
  it("places a French commune name within its own area", () => {
    const place = geocodeCommune("Bab Ezzouar");
    if (!place) throw new Error("expected a match");
    expect(haversineM(place.lat, place.lng, BAB_EZZOUAR.lat, BAB_EZZOUAR.lng)).toBeLessThan(2_000);
    expect(place.commune).toBe("Bab Ezzouar");
  });

  it("ignores case, accents, hyphens and extra spaces", () => {
    expect(geocodeCommune("  BAB   el-oued ")?.commune).toBe("Bab El Oued");
    expect(geocodeCommune("zeralda")?.commune).toBe("Zéralda");
    expect(geocodeCommune("Ain Taya")?.commune).toBe("Aïn Taya");
  });

  it("understands the Arabic name of a commune", () => {
    const place = geocodeCommune("باب الزوار");
    if (!place) throw new Error("expected a match");
    expect(place.commune).toBe("Bab Ezzouar");
    expect(haversineM(place.lat, place.lng, BAB_EZZOUAR.lat, BAB_EZZOUAR.lng)).toBeLessThan(2_000);
  });

  it("reports the commune as a coarse position: several hundred metres to a few km of doubt", () => {
    const place = geocodeCommune("Bab El Oued");
    if (!place) throw new Error("expected a match");
    expect(haversineM(place.lat, place.lng, BAB_EL_OUED.lat, BAB_EL_OUED.lng)).toBeLessThan(2_000);
    expect(place.uncertaintyM).toBeGreaterThanOrEqual(500);
    expect(place.uncertaintyM).toBeLessThanOrEqual(3_000);
  });

  it("returns nothing for a place it does not know", () => {
    expect(geocodeCommune("Tamanrasset")).toBeNull();
    expect(geocodeCommune("")).toBeNull();
  });
});

describe("geocodeLocation (commune or road kilometre point)", () => {
  it("accepts a plain commune name like geocodeCommune", () => {
    expect(geocodeLocation("Rouiba")).toMatchObject({ commune: "Rouiba", uncertaintyM: 1_500 });
  });

  it("places 'RN5 PK 12' on the road between El Harrach (PK 9) and Rouiba (PK 24), more precisely than a commune", () => {
    const place = geocodeLocation("RN5 PK 12");
    if (!place) throw new Error("expected a match");
    // Between the two reference towns, not at either end.
    expect(place.lng).toBeGreaterThan(3.1347);
    expect(place.lng).toBeLessThan(3.28);
    expect(place.uncertaintyM).toBeLessThan(1_500);
    expect(place).toMatchObject({ roadRef: "RN5", pk: 12 });
  });

  it("reads the kilometre point however it is written", () => {
    const a = geocodeLocation("RN5 PK 12");
    for (const text of ["rn5 pk12", "RN 5, P.K. 12", "RN5 PK 12.0"]) {
      expect(geocodeLocation(text)).toEqual(a);
    }
  });

  it("returns nothing for a kilometre point off the known stretch or on an unknown road", () => {
    expect(geocodeLocation("RN5 PK 300")).toBeNull();
    expect(geocodeLocation("RN99 PK 12")).toBeNull();
  });
});

describe("listCommunes", () => {
  it("lists the communes with their centre, for a place picker", () => {
    const list = listCommunes();

    expect(list.length).toBeGreaterThanOrEqual(13);
    expect(list.find((c) => c.name === "Bab Ezzouar")).toEqual({ name: "Bab Ezzouar", lat: 36.7255, lng: 3.1836 });
    expect(list.map((c) => c.name)).toEqual([...list.map((c) => c.name)].sort((a, b) => a.localeCompare(b, "fr")));
  });
});
