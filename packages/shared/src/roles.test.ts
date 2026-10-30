import { describe, expect, it } from "vitest";

import { canAccess, landingPathFor, type AppRole } from "./roles";

describe("landingPathFor", () => {
  it("sends each role to its own screen", () => {
    expect(landingPathFor({ role: "dispatcher", unitId: null, hospitalId: null })).toBe("/dispatcher");
    expect(landingPathFor({ role: "admin", unitId: null, hospitalId: null })).toBe("/console");
  });

  it("sends a medic to the screen of their ambulance unit", () => {
    expect(landingPathFor({ role: "medic", unitId: "unit-42", hospitalId: null })).toBe(
      "/ambulance/unit-42",
    );
  });

  it("sends hospital staff to the board of their hospital", () => {
    expect(landingPathFor({ role: "hospital", unitId: null, hospitalId: "h-7" })).toBe(
      "/hospital/h-7",
    );
  });

  it("returns null when a medic has no unit or hospital staff have no hospital", () => {
    expect(landingPathFor({ role: "medic", unitId: null, hospitalId: null })).toBeNull();
    expect(landingPathFor({ role: "hospital", unitId: null, hospitalId: null })).toBeNull();
  });
});

describe("canAccess", () => {
  const user = (role: AppRole, unitId: string | null = null, hospitalId: string | null = null) => ({
    role,
    unitId,
    hospitalId,
  });

  it("lets the admin open every screen", () => {
    const admin = user("admin");
    expect(canAccess(admin, { screen: "dispatcher" })).toBe(true);
    expect(canAccess(admin, { screen: "console" })).toBe(true);
    expect(canAccess(admin, { screen: "iot" })).toBe(true);
    expect(canAccess(admin, { screen: "ambulance", unitId: "u1" })).toBe(true);
    expect(canAccess(admin, { screen: "hospital", hospitalId: "h1" })).toBe(true);
  });

  it("keeps the dispatcher on the dispatcher screen only", () => {
    const dispatcher = user("dispatcher");
    expect(canAccess(dispatcher, { screen: "dispatcher" })).toBe(true);
    expect(canAccess(dispatcher, { screen: "console" })).toBe(false);
    expect(canAccess(dispatcher, { screen: "iot" })).toBe(false);
    expect(canAccess(dispatcher, { screen: "hospital", hospitalId: "h1" })).toBe(false);
  });

  it("lets a medic open only the screen of their own unit", () => {
    const medic = user("medic", "u1");
    expect(canAccess(medic, { screen: "ambulance", unitId: "u1" })).toBe(true);
    expect(canAccess(medic, { screen: "ambulance", unitId: "u2" })).toBe(false);
    expect(canAccess(medic, { screen: "dispatcher" })).toBe(false);
  });

  it("lets hospital staff open only the board of their own hospital", () => {
    const staff = user("hospital", null, "h1");
    expect(canAccess(staff, { screen: "hospital", hospitalId: "h1" })).toBe(true);
    expect(canAccess(staff, { screen: "hospital", hospitalId: "h2" })).toBe(false);
    expect(canAccess(staff, { screen: "ambulance", unitId: "u1" })).toBe(false);
  });

  it("refuses a medic or hospital account that has no unit or hospital", () => {
    expect(canAccess(user("medic"), { screen: "ambulance", unitId: "u1" })).toBe(false);
    expect(canAccess(user("hospital"), { screen: "hospital", hospitalId: "h1" })).toBe(false);
  });
});
