import { describe, expect, it } from "vitest";

import { pointInPolygon, type GeoJsonPolygon } from "./polygon";

const box = (west: number, south: number, east: number, north: number): GeoJsonPolygon => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

// The seeded demo perimeters (GeoJSON order is [lng, lat]).
const algerCentre = box(3.03, 36.75, 3.08, 36.79);
const babEzzouar = box(3.165, 36.715, 3.205, 36.74);

describe("pointInPolygon", () => {
  it("places Algiers coordinates in the right urban perimeter", () => {
    expect(pointInPolygon(36.7538, 3.0588, algerCentre)).toBe(true); // Alger-Centre
    expect(pointInPolygon(36.725, 3.183, algerCentre)).toBe(false); // Bab Ezzouar is elsewhere
    expect(pointInPolygon(36.725, 3.183, babEzzouar)).toBe(true);
    expect(pointInPolygon(36.7, 2.0, babEzzouar)).toBe(false); // open country
  });

  it("handles a concave polygon (an L shape) correctly", () => {
    const lShape: GeoJsonPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [2, 2],
          [2, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    };
    expect(pointInPolygon(1, 1, lShape)).toBe(true); // lat 1, lng 1: inside the corner
    expect(pointInPolygon(3, 1, lShape)).toBe(true); // lat 3, lng 1: up the tall arm
    expect(pointInPolygon(1, 3, lShape)).toBe(true); // lat 1, lng 3: along the foot
    expect(pointInPolygon(3, 3, lShape)).toBe(false); // lat 3, lng 3: the notch
    expect(pointInPolygon(1, 5, lShape)).toBe(false); // outside altogether
  });

  it("treats a hole as outside", () => {
    const withHole: GeoJsonPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    };
    expect(pointInPolygon(2, 2, withHole)).toBe(true);
    expect(pointInPolygon(5, 5, withHole)).toBe(false);
  });
});
