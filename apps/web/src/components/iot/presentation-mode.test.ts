import { describe, expect, it } from "vitest";
import { getPresentationKeyAction } from "./presentation";

describe("Presentation mode keyboard and UI controls (FR-S8-09, NFR-S8-1)", () => {
  it("maps keys 1 to 5 to the corresponding scenarios", () => {
    expect(getPresentationKeyAction("1")).toEqual({ action: "scenario", key: "1" });
    expect(getPresentationKeyAction("2")).toEqual({ action: "scenario", key: "2" });
    expect(getPresentationKeyAction("3")).toEqual({ action: "scenario", key: "3" });
    expect(getPresentationKeyAction("4")).toEqual({ action: "scenario", key: "4" });
    expect(getPresentationKeyAction("5")).toEqual({ action: "scenario", key: "5" });
  });

  it("maps F / f to fullscreen action", () => {
    expect(getPresentationKeyAction("f")).toEqual({ action: "fullscreen" });
    expect(getPresentationKeyAction("F")).toEqual({ action: "fullscreen" });
  });

  it("maps R / r to reset action", () => {
    expect(getPresentationKeyAction("r")).toEqual({ action: "reset" });
    expect(getPresentationKeyAction("R")).toEqual({ action: "reset" });
  });

  it("maps Space to cancel during CONFIRM state", () => {
    expect(getPresentationKeyAction(" ", "CONFIRM")).toEqual({ action: "cancel" });
    // Space outside CONFIRM does nothing
    expect(getPresentationKeyAction(" ", "ARMED")).toBeNull();
  });

  it("ignores non-mapped keys", () => {
    expect(getPresentationKeyAction("x")).toBeNull();
    expect(getPresentationKeyAction("Enter")).toBeNull();
  });
});
