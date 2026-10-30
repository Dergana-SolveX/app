import { describe, expect, it } from "vitest";
import {
  createSurveyManager,
  type CurrentCellInfo,
  type CurrentGpsFix,
} from "./survey-manager";

describe("SurveyManager State Machine (FR-S4-08)", () => {
  const ALGIERS_CELL: CurrentCellInfo = {
    mcc: 603,
    mnc: 1,
    lac: 100,
    cid: 5541,
    signalDbm: -72,
  };

  const ALGIERS_GPS: CurrentGpsFix = {
    lat: 36.7538,
    lng: 3.0588,
    accuracyM: 4.5,
    timestamp: 1700000000000,
  };

  it("initializes with empty GPS and cell state", () => {
    const manager = createSurveyManager();
    const state = manager.getState();

    expect(state.currentCell).toBeNull();
    expect(state.currentGps).toBeNull();
    expect(state.isContinuous).toBe(false);
    expect(state.loggedPoints).toHaveLength(0);
    expect(state.canLog).toBe(false);
  });

  it("allows logging when both Cell-ID and GPS fix are present", () => {
    const manager = createSurveyManager();

    manager.updateCell(ALGIERS_CELL);
    expect(manager.getState().canLog).toBe(false);

    manager.updateGps(ALGIERS_GPS);
    expect(manager.getState().canLog).toBe(true);

    const point = manager.logPoint();
    expect(point).not.toBeNull();
    expect(point!.mcc).toBe(603);
    expect(point!.mnc).toBe(1);
    expect(point!.cid).toBe(5541);
    expect(point!.lat).toBeCloseTo(36.7538, 4);
    expect(point!.status).toBe("pending");

    expect(manager.getState().loggedPoints).toHaveLength(1);
  });

  it("marks a logged point as synced when server acknowledges", () => {
    const manager = createSurveyManager();
    manager.updateCell(ALGIERS_CELL);
    manager.updateGps(ALGIERS_GPS);

    const point = manager.logPoint()!;
    expect(point.status).toBe("pending");

    manager.markSynced(point.id);
    expect(manager.getState().loggedPoints[0]!.status).toBe("synced");
  });

  it("auto-logs in continuous mode when moving beyond threshold distance (> 50m)", () => {
    const manager = createSurveyManager({ autoDistanceM: 50 });
    manager.updateCell(ALGIERS_CELL);
    manager.updateGps(ALGIERS_GPS);

    // Initial manual log
    manager.logPoint();
    expect(manager.getState().loggedPoints).toHaveLength(1);

    // Turn on continuous mode
    manager.setContinuous(true);

    // Minor movement: 5 meters (should NOT trigger log)
    manager.updateGps({
      lat: 36.75384, // ~4.5m north
      lng: 3.0588,
      accuracyM: 5,
      timestamp: 1700000005000,
    });
    expect(manager.getState().loggedPoints).toHaveLength(1);

    // Significant movement: ~150 meters north
    manager.updateGps({
      lat: 36.7552, // ~155m north
      lng: 3.0588,
      accuracyM: 5,
      timestamp: 1700000015000,
    });
    expect(manager.getState().loggedPoints).toHaveLength(2);
    expect(manager.getState().loggedPoints[0]!.lat).toBeCloseTo(36.7552, 4);
  });
});
