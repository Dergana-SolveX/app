import type { Database } from "@solvex-dergana/db";
import {
  incidentEvents,
  masterIncidents,
  medicalProfiles,
  rawAlerts,
  zones,
} from "@solvex-dergana/db/schema/index";
import { createTestDb } from "@solvex-dergana/db/testing";
import { decodeGeohash, encodeSvx, type SvxAlert } from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { DispatcherEvent, EventBus } from "./events";
import { createEventBus } from "./events";
import { getIncident } from "./incidents";
import { ingestSms } from "./ingest";
import { retriageIncident } from "./triage";

const GEOHASH = "sn2j5x7k";
const RECEIVED_AT = new Date("2026-10-30T09:01:00Z");

const witnessAlert: SvxAlert = {
  layer: 2,
  geohash: GEOHASH,
  eventMinutes: 29889180,
  peakG: null,
  rollover: null,
  fire: false,
  victims: 2,
  conscious: 1,
  trapped: false,
  bleeding: true,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
};

/** An urban perimeter around the test geohash, so the authority is the Sûreté Nationale. */
async function seedZoneAround(db: Database, geohash: string) {
  const { lat, lng } = decodeGeohash(geohash)!;
  const [w, e, s, n] = [lng - 0.01, lng + 0.01, lat - 0.01, lat + 0.01];
  await db.insert(zones).values({
    name: "Zone d'essai",
    polygon: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  });
}

/** An event bus that remembers what was published, so the test can read it back. */
function recordingBus() {
  const published: DispatcherEvent[] = [];
  const bus = { publish: (event: DispatcherEvent) => void published.push(event), stream: createEventBus().stream };
  return { bus: bus as EventBus, published };
}

async function ingestWitness(db: Database, events: EventBus, alert: SvxAlert = witnessAlert) {
  const result = await ingestSms(
    { db, events },
    { from: "+213550000001", body: encodeSvx(alert), receivedAt: RECEIVED_AT, emulated: true },
  );
  if (result.kind !== "alert") throw new Error("expected an alert");
  return result.incidentId;
}

describe("a new alert is triaged automatically (FR-S3-06, FR-S5-02)", () => {
  it("stores the recommendation in rec_* fields and writes it to incident_events", async () => {
    const db = await createTestDb();
    await seedZoneAround(db, GEOHASH);
    const { bus } = recordingBus();

    const incidentId = await ingestWitness(db, bus, { ...witnessAlert, trapped: true });

    const incident = await getIncident(db, incidentId);
    expect(incident).toMatchObject({ recSeverity: "red", recAuthority: "surete_nationale", status: "open" });
    expect(incident?.recUnits?.map((u) => u.type).sort()).toEqual(["ambulance_medicalisee", "desincarceration"]);
    expect(incident?.vittelPrefill?.l2?.["victime incarcérée"]).toEqual({ value: true, source: "app" });

    const events = await db.select().from(incidentEvents).where(eq(incidentEvents.incidentId, incidentId));
    const recommended = events.filter((e) => e.type === "triage.recommended");
    expect(recommended).toHaveLength(1);
    expect(recommended[0]).toMatchObject({ actorRole: "system" });
    expect(recommended[0]?.payload).toMatchObject({ severity: "red", authority: "surete_nationale" });
  });

  it("a position outside every perimeter goes to the Gendarmerie", async () => {
    const db = await createTestDb(); // no zone seeded
    const incidentId = await ingestWitness(db, recordingBus().bus);

    expect((await getIncident(db, incidentId))?.recAuthority).toBe("gendarmerie_nationale");
  });
});

describe("re-triage when more information arrives", () => {
  async function addAlert(db: Database, incidentId: string, values: Partial<typeof rawAlerts.$inferInsert>) {
    await db.insert(rawAlerts).values({ incidentId, source: "app_witness", channel: "internet", ...values });
  }

  it("before any dispatch, a worse picture updates the recommendation and tells the dispatcher screens", async () => {
    const db = await createTestDb();
    const { bus, published } = recordingBus();
    const incidentId = await ingestWitness(db, bus); // bleeding only: YELLOW
    expect((await getIncident(db, incidentId))?.recSeverity).toBe("yellow");

    await addAlert(db, incidentId, { fire: true });
    await retriageIncident({ db, events: bus }, incidentId);

    expect((await getIncident(db, incidentId))?.recSeverity).toBe("red");
    expect(published.map((e) => e.type)).toContain("incident.updated");
  });

  it("after a dispatch, a worse picture only suggests an escalation and changes nothing", async () => {
    const db = await createTestDb();
    const { bus, published } = recordingBus();
    const incidentId = await ingestWitness(db, bus); // YELLOW
    await db.update(masterIncidents).set({ status: "dispatched" }).where(eq(masterIncidents.id, incidentId));
    const before = await getIncident(db, incidentId);

    await addAlert(db, incidentId, { fire: true });
    await retriageIncident({ db, events: bus }, incidentId);

    const after = await getIncident(db, incidentId);
    expect(after).toMatchObject({ recSeverity: "yellow", recUnits: before?.recUnits, status: "dispatched" });
    expect(published).toContainEqual(
      expect.objectContaining({ type: "incident.escalation_suggested", incidentId, from: "yellow", to: "red" }),
    );
    const events = await db.select().from(incidentEvents).where(eq(incidentEvents.incidentId, incidentId));
    expect(events.map((e) => e.type)).toContain("incident.escalation_suggested");
  });

  it("after a dispatch, a recommendation that did not get worse produces no escalation", async () => {
    const db = await createTestDb();
    const { bus, published } = recordingBus();
    const incidentId = await ingestWitness(db, bus);
    await db.update(masterIncidents).set({ status: "dispatched" }).where(eq(masterIncidents.id, incidentId));
    published.length = 0;

    await retriageIncident({ db, events: bus }, incidentId);

    expect(published.map((e) => e.type)).not.toContain("incident.escalation_suggested");
  });

  it("a linked anticoagulant profile with a 4 g hit makes it RED", async () => {
    const db = await createTestDb();
    const [profile] = await db
      .insert(medicalProfiles)
      .values({
        shortCode: "TESTCODE",
        fullName: "Profil d'essai",
        birthDate: "1960-01-01",
        sex: "male",
        medications: [{ name: "Sintrom", class: "anticoagulant" }],
        consentAt: RECEIVED_AT,
      })
      .returning({ id: medicalProfiles.id });
    const incidentId = await ingestWitness(db, recordingBus().bus, { ...witnessAlert, bleeding: false });
    expect((await getIncident(db, incidentId))?.recSeverity).toBe("unknown");

    await addAlert(db, incidentId, { gForce: 4, profileId: profile!.id });
    await retriageIncident({ db, events: recordingBus().bus }, incidentId);

    expect((await getIncident(db, incidentId))?.recSeverity).toBe("red");
  });
});
