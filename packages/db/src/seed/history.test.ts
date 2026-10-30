import { describe, expect, it } from "vitest";

import { dispatches, handovers, masterIncidents, medicAssessments, rawAlerts } from "../schema";
import { createTestDb } from "../testing";
import { resetApp, seed } from "./index";

const secrets = {
  masterDeviceSecret: "0000000000000000000000000000000000000000000000000000000000000000",
  demoPassword: "svx-demo-2026",
};

describe("seedDemoHistory (~40 emulated incidents over 30 days)", () => {
  it("seeds ~40 emulated incidents with alerts, dispatches, assessments and handovers", async () => {
    const db = await createTestDb();
    await seed(db, secrets);

    const incidents = await db.select().from(masterIncidents);
    // PRD FR-S1-07: ~40 past incidents over the last 30 days
    expect(incidents.length).toBeGreaterThanOrEqual(35);
    expect(incidents.length).toBeLessThanOrEqual(45);

    // All seeded incidents must be marked emulated
    expect(incidents.every((inc) => inc.emulated === true)).toBe(true);

    // Spanning the last 30 days
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const timestamps = incidents.map((inc) => inc.firstAlertAt.getTime());
    expect(Math.min(...timestamps)).toBeGreaterThanOrEqual(thirtyDaysAgo - 24 * 60 * 60 * 1000);
    expect(Math.max(...timestamps)).toBeLessThanOrEqual(now + 1000);

    // Alerts exist and include channel mix (internet, sms, ussd)
    const alerts = await db.select().from(rawAlerts);
    expect(alerts.length).toBeGreaterThanOrEqual(incidents.length);
    expect(alerts.every((a) => a.emulated === true)).toBe(true);
    const channels = new Set(alerts.map((a) => a.channel));
    expect(channels.has("internet")).toBe(true);
    expect(channels.has("sms")).toBe(true);
    expect(channels.has("ussd")).toBe(true);

    // Dispatches exist with emulated = true and realistic decision times
    const disps = await db.select().from(dispatches);
    expect(disps.length).toBeGreaterThanOrEqual(incidents.length);
    expect(disps.every((d) => d.emulated === true)).toBe(true);
    // Recommendation overrides exist with reasons
    const overrides = disps.filter((d) => d.modified);
    expect(overrides.length).toBeGreaterThan(0);
    expect(overrides.every((d) => Boolean(d.modificationReason))).toBe(true);

    // Clinical assessments and handovers exist with emulated = true
    const assessments = await db.select().from(medicAssessments);
    expect(assessments.length).toBeGreaterThan(0);
    expect(assessments.every((a) => a.emulated === true)).toBe(true);

    const hds = await db.select().from(handovers);
    expect(hds.length).toBeGreaterThan(0);
    expect(hds.every((h) => h.emulated === true)).toBe(true);
  });

  it("is restored cleanly by resetApp", async () => {
    const db = await createTestDb();
    await seed(db, secrets);

    const countBefore = (await db.select().from(masterIncidents)).length;
    await resetApp(db, secrets);
    const countAfter = (await db.select().from(masterIncidents)).length;

    expect(countAfter).toBe(countBefore);
  });
});
