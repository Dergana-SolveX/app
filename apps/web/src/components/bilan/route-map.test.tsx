import type {
  HospitalMatch,
  MatchHospital,
  RoadGraph,
} from "@solvex-dergana/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { HospitalRouteMap } from "./route-map";

const hospital: MatchHospital = {
  id: "hospital-1",
  name: "Hôpital central",
  shortName: "Central",
  tier: "chu",
  lat: 36.7001,
  lng: 3.0001,
  capabilities: {},
  status: {},
  stabilizationOnly: false,
};

const match: HospitalMatch = {
  hospitalId: hospital.id,
  etaMin: 7,
  etaSource: "road",
  distanceM: 3200,
  matched: [],
  missing: [],
  diverting: [],
  preferredMatched: [],
  preferredMissing: [],
  score: 7,
  scoreBreakdown: { etaMin: 7, missingPenaltyMin: 0, divertPenaltyMin: 0 },
  flags: [],
};

const graph = {
  meta: {},
  names: [],
  lat: new Float64Array([36.7]),
  lng: new Float64Array([3]),
  outStart: new Int32Array([0, 0]),
  edgeTo: new Int32Array(),
  edgeLengthM: new Float64Array(),
  edgeSeconds: new Float64Array(),
  edgeClass: new Uint8Array(),
  edgeName: new Int32Array(),
  edgeShape: [],
  edgeReversed: new Uint8Array(),
  maxSpeedMps: 1,
} as unknown as RoadGraph;

it("shows the accident and suggested hospital on a road map and selects the hospital", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 440,
    width: 800,
    height: 440,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(440);

  const choose = vi.fn();
  render(
    <HospitalRouteMap
      scene={[36.7, 3]}
      graph={graph}
      suggestions={[{ rank: 1, hospital, match }]}
      recommendedId={hospital.id}
      chosenId={null}
      onChoose={choose}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Lieu de l'accident" }),
  ).toBeTruthy();
  const hospitalMarker = screen.getByRole("button", {
    name: "1. Hôpital central, 7 min",
  });
  fireEvent.click(hospitalMarker, { clientX: 100, clientY: 100 });
  expect(choose).toHaveBeenCalledWith(hospital.id);
  expect(screen.getByRole("link", { name: /OpenStreetMap/ })).toBeTruthy();
});
