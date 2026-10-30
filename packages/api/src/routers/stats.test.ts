import { createTestDb } from "@solvex-dergana/db/testing";
import { seed } from "@solvex-dergana/db/seed/index";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "../context";
import { createEventBus } from "../services/events";
import { appRouter } from "./index";

const secrets = {
  masterDeviceSecret: "0000000000000000000000000000000000000000000000000000000000000000",
  demoPassword: "svx-demo-2026",
};

const MUSTAPHA_ID = "00000000-0000-4000-8000-000000000101";

function makeContext(
  db: any,
  appUser: AppUserContext | null,
): Context {
  return {
    session: { user: { id: "auth" } } as any,
    appUser,
    db,
    events: createEventBus(),
    smsTransport: { kind: "emulator", send: async () => {} } as any,
  };
}

describe("stats router (role-scoped queries, real tables, emulated filter)", () => {
  it("rejects unauthorized medic from dispatcher stats", async () => {
    const db = await createTestDb();
    const caller = appRouter.createCaller(
      makeContext(db, { id: "u-medic", role: "medic", unitId: "unit-1", hospitalId: null }),
    );

    await expect(caller.stats.dispatcher()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows dispatcher and returns comprehensive FR-ST-01 metrics over seeded demo history", async () => {
    const db = await createTestDb();
    await seed(db, secrets);

    const caller = appRouter.createCaller(
      makeContext(db, { id: "u-disp", role: "dispatcher", unitId: null, hospitalId: null }),
    );

    const stats = await caller.stats.dispatcher({ includeEmulated: true });

    // Summary
    expect(stats.summary.totalIncidents).toBeGreaterThanOrEqual(35);
    expect(stats.summary.emulatedIncidents).toBeGreaterThanOrEqual(35);

    // Decision times (crash -> dispatch)
    expect(stats.decisionTimes.medianSeconds).toBeGreaterThan(0);
    expect(stats.decisionTimes.p90Seconds).toBeGreaterThanOrEqual(stats.decisionTimes.medianSeconds);
    expect(stats.decisionTimes.trend.length).toBeGreaterThan(0);

    // Alerts merged per incident
    expect(stats.alertsMerged.averagePerIncident).toBeGreaterThanOrEqual(1);
    expect(stats.alertsMerged.single).toBeGreaterThan(0);

    // Channel mix
    expect(stats.channelMix.internet).toBeGreaterThan(0);
    expect(stats.channelMix.sms).toBeGreaterThan(0);
    expect(stats.channelMix.ussd).toBeGreaterThan(0);

    // Severity split
    expect(stats.severitySplit.red).toBeGreaterThan(0);
    expect(stats.severitySplit.yellow).toBeGreaterThan(0);

    // Override rate & reasons
    expect(stats.overrideRate.total).toBeGreaterThan(0);
    expect(stats.overrideRate.overridden).toBeGreaterThan(0);
    expect(stats.overrideRate.percentage).toBeGreaterThan(0);
    expect(stats.overrideRate.topReasons.length).toBeGreaterThan(0);

    // Breakdown by commune & authority
    expect(stats.byCommune.length).toBeGreaterThan(0);
    expect(stats.byAuthority.length).toBeGreaterThan(0);
  });

  it("filters out emulated data when includeEmulated is false", async () => {
    const db = await createTestDb();
    await seed(db, secrets);

    const caller = appRouter.createCaller(
      makeContext(db, { id: "u-disp", role: "dispatcher", unitId: null, hospitalId: null }),
    );

    const stats = await caller.stats.dispatcher({ includeEmulated: false });
    // All seeded data is emulated, so without emulated, incident count should be 0
    expect(stats.summary.totalIncidents).toBe(0);
    expect(stats.summary.emulatedIncidents).toBe(0);
  });

  it("scopes hospital stats to the user's hospital and prevents cross-hospital access", async () => {
    const db = await createTestDb();
    await seed(db, secrets);

    const hospitalCaller = appRouter.createCaller(
      makeContext(db, { id: "u-hosp", role: "hospital", unitId: null, hospitalId: MUSTAPHA_ID }),
    );

    // Querying own hospital succeeds
    const stats = await hospitalCaller.stats.hospital({ hospitalId: MUSTAPHA_ID, includeEmulated: true });
    expect(stats.acceptVsDivert.accepted + stats.acceptVsDivert.diverted).toBeGreaterThan(0);

    // Attempting to query another hospital is forbidden
    await expect(
      hospitalCaller.stats.hospital({
        hospitalId: "00000000-0000-4000-8000-000000000102",
        includeEmulated: true,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
