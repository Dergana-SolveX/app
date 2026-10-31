import { createTestDb } from "@solvex-dergana/db/testing";
import { incidentEvents, medicalProfiles } from "@solvex-dergana/db/schema/index";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AppUserContext } from "../context";
import { t } from "../index";
import { profilesRouter } from "./profiles";

async function setupCaller(user?: { role: AppUserContext["role"]; id: string }) {
  const db = await createTestDb();
  const session = user
    ? {
        user: { id: user.id },
        session: {
          id: "s1",
          userId: user.id,
          token: "tok",
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }
    : null;
  const appUser: AppUserContext | null = user
    ? { id: user.id, role: user.role, unitId: null, hospitalId: null }
    : null;

  const caller = t.createCallerFactory(profilesRouter)({
    db,
    session: session as any,
    appUser,
    smsTransport: { kind: "emulator", send: async () => {} },
    events: {
      publish: () => {},
      subscribe: () => () => {},
    } as any,
  });

  return { db, caller };
}

describe("profilesRouter (Issue 24 - TDD Cycle 1)", () => {
  describe("profiles.register", () => {
    it("registers a medical profile without requiring an account, generates short_code and sets consent_at", async () => {
      const { db, caller } = await setupCaller(undefined);

      const result = await caller.register({
        fullName: "Amina Benali",
        sex: "female",
        phone: "+213 555 12 34 56",
        bloodType: "O+",
        chronicConditions: ["diabète de type 1", "asthme"],
        consent: true,
      });

      expect(result).toBeDefined();
      expect(result.id).toBeTypeOf("string");
      expect(result.shortCode).toMatch(/^[0-9A-Z]{8}$/);
      expect(result.fullName).toBe("Amina Benali");
      expect(result.consentAt).toBeInstanceOf(Date);

      // Verify row in DB
      const [stored] = await db
        .select()
        .from(medicalProfiles)
        .where(eq(medicalProfiles.shortCode, result.shortCode));

      expect(stored).toBeDefined();
      expect(stored!.fullName).toBe("Amina Benali");
      expect(stored!.sex).toBe("female");
      expect(stored!.bloodType).toBe("O+");
      expect(stored!.emergencyContact).toBe("+213 555 12 34 56");
      expect(stored!.chronicConditions).toEqual(["diabète de type 1", "asthme"]);
      expect(stored!.consentAt).toBeInstanceOf(Date);
    });

    it("rejects registration when Law 18-07 consent is not given", async () => {
      const { caller } = await setupCaller(undefined);

      await expect(
        caller.register({
          fullName: "Anis Mansour",
          sex: "male",
          phone: "0550112233",
          bloodType: "A+",
          chronicConditions: [],
          consent: false as any,
        }),
      ).rejects.toThrow();
    });
  });

  describe("profiles.byShortCode", () => {
    it("is role-gated: forbids unauthenticated or unauthorized users", async () => {
      const { db, caller: publicCaller } = await setupCaller(undefined);

      // Seed a profile
      await db.insert(medicalProfiles).values({
        shortCode: "TESTCD01",
        fullName: "Samir Test",
        birthDate: "1985-05-15",
        sex: "male",
        bloodType: "B+",
        consentAt: new Date(),
      });

      // Calling without role must fail
      await expect(
        publicCaller.byShortCode({ shortCode: "TESTCD01" }),
      ).rejects.toThrow(/Authentication required|Your role cannot access this resource/);
    });

    it("allows authorized dispatcher, returns profile, and logs access to incident_events", async () => {
      const { db, caller } = await setupCaller({ id: "disp-1", role: "dispatcher" });

      const [profile] = await db
        .insert(medicalProfiles)
        .values({
          shortCode: "TESTCD02",
          fullName: "Fatima Test",
          birthDate: "1992-03-20",
          sex: "female",
          bloodType: "AB+",
          emergencyContact: "0661223344",
          chronicConditions: ["hypertension artérielle"],
          consentAt: new Date(),
        })
        .returning();

      const fetched = await caller.byShortCode({ shortCode: "TESTCD02" });

      expect(fetched).toBeDefined();
      expect(fetched.id).toBe(profile!.id);
      expect(fetched.fullName).toBe("Fatima Test");
      expect(fetched.bloodType).toBe("AB+");

      // Verify access logged to incident_events
      const events = await db
        .select()
        .from(incidentEvents)
        .where(eq(incidentEvents.type, "profile.accessed"));

      expect(events).toHaveLength(1);
      expect(events[0]!.actorRole).toBe("dispatcher");
      expect(events[0]!.actorId).toBe("disp-1");
      expect((events[0]!.payload as any).shortCode).toBe("TESTCD02");
    });
  });
});
