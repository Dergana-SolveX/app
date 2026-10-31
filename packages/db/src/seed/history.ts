import { sql } from "drizzle-orm";
import type { Database } from "../index";
import {
  dispatches,
  handovers,
  incidentEvents,
  masterIncidents,
  medicAssessments,
  rawAlerts,
} from "../schema";
import { units } from "./units";

const COMMUNE_COORDINATES: Array<{ commune: string; lat: number; lng: number; roadRef: string }> = [
  { commune: "Sidi M'Hamed", lat: 36.758, lng: 3.055, roadRef: "Boulevard Mohamed V" },
  { commune: "Bab El Oued", lat: 36.791, lng: 3.048, roadRef: "Avenue du 1er Novembre" },
  { commune: "Kouba", lat: 36.728, lng: 3.082, roadRef: "RN 1 (Bretelle Kouba)" },
  { commune: "Bab Ezzouar", lat: 36.719, lng: 3.182, roadRef: "Autoroute de l'Est (A1)" },
  { commune: "Hussein Dey", lat: 36.742, lng: 3.091, roadRef: "Rue Tripoli" },
  { commune: "Bir Mourad Raïs", lat: 36.736, lng: 3.051, roadRef: "Liaison Châteauneuf" },
  { commune: "Dar El Beïda", lat: 36.712, lng: 3.218, roadRef: "Route de l'Aéroport" },
  { commune: "Rouiba", lat: 36.734, lng: 3.285, roadRef: "Zone Industrielle Rouiba" },
  { commune: "Hydra", lat: 36.746, lng: 3.038, roadRef: "Chemin Doudou Mokhtar" },
  { commune: "Ben Aknoun", lat: 36.759, lng: 3.012, roadRef: "Rocade Sud (Échangeur Ben Aknoun)" },
  { commune: "Chéraga", lat: 36.768, lng: 2.955, roadRef: "Route de Chéraga" },
  { commune: "Zeralda", lat: 36.711, lng: 2.842, roadRef: "Autoroute Ouest (Zeralda)" },
  { commune: "El Biar", lat: 36.771, lng: 3.032, roadRef: "Boulevard Bougara" },
  { commune: "Bouzareah", lat: 36.791, lng: 3.018, roadRef: "Route de l'Observatoire" },
  { commune: "Reghaïa", lat: 36.738, lng: 3.342, roadRef: "RN 5 (Reghaïa)" },
  { commune: "Bordj El Kiffan", lat: 36.751, lng: 3.195, roadRef: "RN 24 (Bordj El Kiffan)" },
  { commune: "Birtouta", lat: 36.645, lng: 3.002, roadRef: "Pénétrante Birtouta" },
  { commune: "Baraki", lat: 36.662, lng: 3.098, roadRef: "2ème Rocade Sud" },
];

const HOSPITAL_IDS: string[] = [
  "00000000-0000-4000-8000-000000000101", // Mustapha
  "00000000-0000-4000-8000-000000000102", // Bab El Oued
  "00000000-0000-4000-8000-000000000103", // Beni Messous
  "00000000-0000-4000-8000-000000000104", // Nafissa Hamoud
  "00000000-0000-4000-8000-000000000105", // Ait Idir
  "00000000-0000-4000-8000-000000000106", // HMRU Kouba
  "00000000-0000-4000-8000-000000000107", // Rouiba
  "00000000-0000-4000-8000-000000000108", // Zeralda
  "00000000-0000-4000-8000-000000000110", // Poly Bab Ezzouar
];

const UNIT_IDS: string[] = [
  "00000000-0000-4000-8000-000000000201",
  "00000000-0000-4000-8000-000000000202",
  "00000000-0000-4000-8000-000000000203",
  "00000000-0000-4000-8000-000000000204",
  "00000000-0000-4000-8000-000000000205",
  "00000000-0000-4000-8000-000000000206",
  "00000000-0000-4000-8000-000000000207",
  "00000000-0000-4000-8000-000000000208",
];

const unitMap = new Map(units.map((u) => [u.id, u]));
const DEMO_DISPATCHER_ID = "00000000-0000-4000-8000-000000000601";

const OVERRIDE_REASONS = [
  "Unité la plus proche indisponible (en intervention)",
  "Renfort VSR nécessaire pour désincarcération suspectée",
  "SMUR requis immédiatement vu antécédents cardiaques",
  "Accès difficile route secondaire, préférer véhicule léger",
  "Effectif insuffisant sur unité recommandée, basculé sur unité voisine",
];

/**
 * Seeds ~40 past incidents over the last 30 days (FR-S1-07).
 * All rows have `emulated = true`.
 */
export async function seedDemoHistory(db: Database) {
  const now = Date.now();
  const totalIncidents = 40;

  const incidentRows: Array<typeof masterIncidents.$inferInsert> = [];
  const alertRows: Array<typeof rawAlerts.$inferInsert> = [];
  const dispatchRows: Array<typeof dispatches.$inferInsert> = [];
  const eventRows: Array<typeof incidentEvents.$inferInsert> = [];
  const assessmentRows: Array<typeof medicAssessments.$inferInsert> = [];
  const handoverRows: Array<typeof handovers.$inferInsert> = [];

  for (let i = 0; i < totalIncidents; i++) {
    const pad = String(i + 1).padStart(4, "0");
    const incidentId = `00000000-0000-4000-9000-00000000${pad}`;
    const location = COMMUNE_COORDINATES[i % COMMUNE_COORDINATES.length]!;

    // Spread closed history over 30 days, keep recent active incidents within the last hour
    let alertTimeMs: number;
    if (i >= 37) {
      // Recent active missions: 15 to 45 minutes ago
      const minutesAgo = (40 - i) * 15;
      alertTimeMs = now - minutesAgo * 60 * 1000;
    } else {
      const daysAgo = 29 - (i * 28) / 36;
      alertTimeMs = now - Math.round(daysAgo * 24 * 60 * 60 * 1000);
    }
    const firstAlertAt = new Date(alertTimeMs);

    // Number of alerts: 1 to 3
    const alertCount = (i % 5 === 0) ? 3 : (i % 3 === 0) ? 2 : 1;
    const lastAlertAt = new Date(alertTimeMs + (alertCount - 1) * 12_000);

    // Severity distribution: red (~40%), yellow (~45%), green (~15%)
    let recSeverity = i % 10 < 4 ? "red" : i % 10 < 8 ? "yellow" : "green";

    // Rec authority: gendarmerie_nationale for highway/rural communes, surete_nationale for urban
    const recAuthority =
      location.roadRef.includes("Autoroute") || location.commune === "Zeralda" || location.commune === "Reghaïa"
        ? "gendarmerie_nationale"
        : "surete_nationale";

    const status = i < 37 ? "closed" : i === 37 ? "dispatched" : "on_scene";

    let assignedUnitId: string;
    if (i === 37) {
      assignedUnitId = "00000000-0000-4000-8000-000000000201"; // PC-ALG-01 (Ambulance médicalisée, Secouriste 1)
    } else if (i === 38) {
      assignedUnitId = "00000000-0000-4000-8000-000000000204"; // PC-HRH-01 (Ambulance médicalisée, Secouriste 2)
    } else if (i === 39) {
      assignedUnitId = "00000000-0000-4000-8000-000000000202"; // PC-BEO-01 (VSAV)
    } else {
      assignedUnitId = UNIT_IDS[i % UNIT_IDS.length]!;
    }

    let estimatedVictims = (i % 3) + 1;
    let linkedProfileIds: string[] = [];

    if (i === 37) {
      recSeverity = "red";
      estimatedVictims = 1;
      linkedProfileIds = ["00000000-0000-4000-8000-000000000301"]; // Profil démo 1 (anticoagulant)
    }

    incidentRows.push({
      id: incidentId,
      lat: location.lat,
      lng: location.lng,
      geohash8: "sn7x6abc",
      locationUncertaintyM: 15,
      firstAlertAt,
      lastAlertAt,
      confidenceScore: (0.85 + (i % 14) * 0.01).toFixed(3),
      alertCount,
      status,
      recSeverity,
      recUnits: [{ type: "vsav_standard", count: 1 }],
      recAuthority,
      commune: location.commune,
      roadRef: location.roadRef,
      estimatedVictims,
      linkedProfileIds,
      emulated: true,
      version: 1,
    });

    // Alert channels mix: ~45% internet, ~35% sms, ~20% ussd
    for (let a = 0; a < alertCount; a++) {
      const channel =
        (i + a) % 5 === 0 ? "ussd" : (i + a) % 2 === 0 ? "sms" : "internet";
      alertRows.push({
        incidentId,
        receivedAt: new Date(alertTimeMs + a * 12_000),
        channel: channel as "internet" | "sms" | "ussd",
        source: "iot",
        lat: location.lat + a * 0.0001,
        lng: location.lng + a * 0.0001,
        emulated: true,
      });
    }

    // Realistic decision delays: median ~50s, p90 ~120s
    const decisionDelaySec =
      i % 10 === 0 ? 140 : i % 10 === 1 ? 115 : 30 + (i % 7) * 8;
    const decidedAt = new Date(alertTimeMs + decisionDelaySec * 1000);

    const isModified = i % 5 === 0; // 20% overrides
    const modificationReason = isModified ? OVERRIDE_REASONS[i % OVERRIDE_REASONS.length] : null;

    const unitObj = unitMap.get(assignedUnitId);
    const unitCallSign = unitObj?.callSign ?? `AMB-${pad}`;
    const unitType = unitObj?.type ?? (isModified ? "ambulance_medicalisee" : "vsav_standard");

    let dispatchNotes: string | null = null;
    if (i === 37) {
      dispatchNotes =
        "Collision VL contre glissière de sécurité. 1 victime incarcérée consciente, douleur thoracique. Équipe médicale requise en priorité.";
    } else if (i === 38) {
      dispatchNotes = "Choc latéral 2 véhicules. Équipe sur place en cours de bilan.";
    } else if (i === 39) {
      dispatchNotes = "Malaise sur la voie publique, équipe sur les lieux.";
    } else if (isModified) {
      dispatchNotes = modificationReason;
    }

    const dispatchUnits = [
      {
        id: assignedUnitId,
        callSign: unitCallSign,
        type: unitType,
      },
    ];

    const dispatchId = `00000000-0000-4000-9100-00000000${pad}`;
    dispatchRows.push({
      id: dispatchId,
      incidentId,
      recommended: { units: [{ type: "vsav_standard", count: 1 }] },
      decided: {
        unitIds: [assignedUnitId],
        units: dispatchUnits,
        notes: dispatchNotes,
      },
      modified: isModified,
      modificationReason,
      dispatcherId: DEMO_DISPATCHER_ID,
      unitIds: [assignedUnitId],
      authorityNotified: true,
      authorityNotifiedAt: new Date(decidedAt.getTime() + 2000),
      decidedAt,
      emulated: true,
    });

    // Journal audit events for seeded incidents
    eventRows.push({
      id: `00000000-0000-4000-9400-00000000${pad}`,
      incidentId,
      actorRole: "system",
      type: "triage.recommended",
      payload: { severity: recSeverity, authority: recAuthority },
      at: firstAlertAt,
    });

    eventRows.push({
      id: `00000000-0000-4000-9500-00000000${pad}`,
      incidentId,
      actorRole: "dispatcher",
      actorId: DEMO_DISPATCHER_ID,
      type: "dispatch.approved",
      payload: { dispatchId, units: [assignedUnitId], modified: isModified },
      at: decidedAt,
    });

    // Generate assessments and handovers for ~32 of the incidents
    if (i < 32) {
      const assessmentId = `00000000-0000-4000-9200-00000000${pad}`;
      const assessedAt = new Date(decidedAt.getTime() + 15 * 60 * 1000); // 15 mins after dispatch

      const hr = 75 + (i % 8) * 8; // 75 - 131
      const sbp = 90 + (i % 6) * 10; // 90 - 140
      const shockIndex = (hr / sbp).toFixed(2);
      const chosenHospitalId = HOSPITAL_IDS[i % HOSPITAL_IDS.length]!;

      assessmentRows.push({
        id: assessmentId,
        incidentId,
        dispatchId,
        unitId: assignedUnitId,
        estAge: 25 + (i * 3) % 50,
        sex: i % 2 === 0 ? "male" : "female",
        hr,
        sbp,
        dbp: 75,
        spo2: 94 + (i % 6),
        gcs: 11 + (i % 5),
        shockIndex,
        recHospitalId: chosenHospitalId,
        chosenHospitalId,
        assessedAt,
        emulated: true,
      });

      // Handovers for ~26 incidents
      if (i < 26) {
        const isDivert = i % 6 === 0; // ~15% divert rate
        const divertSpecialty = isDivert ? "Scanner CT" : null;
        const respondedAt = new Date(assessedAt.getTime() + 45_000);
        const smsFallbackSentAt = (i % 7 === 0) ? new Date(assessedAt.getTime() + 65_000) : null;

        handoverRows.push({
          id: `00000000-0000-4000-9300-00000000${pad}`,
          assessmentId,
          hospitalId: chosenHospitalId,
          atmist: {
            version: 1,
            unit: `AMB-${String((i % 12) + 1).padStart(2, "0")}`,
            victimIndex: 1,
            time: "12:30",
            age: 25 + (i * 3) % 50,
            sex: i % 2 === 0 ? "male" : "female",
            mechanism: ["Collision frontale VL / PL"],
            injuries: ["Traumatisme crânien", "Contusion thoracique"],
            signs: { hr, sbp, dbp: Math.round(sbp * 0.65), spo2: 95, rr: 18, gcs: 13, shockIndex },
            treatments: ["Collier cervical", "O2 6L/min"],
            severe: shockIndex?.flag === "critical",
            needs: isDivert && divertSpecialty ? [divertSpecialty] : [],
            prep: [],
            bloodType: "O+",
            allergies: [],
            etaMin: 12,
          },
          status: isDivert ? "diverted" : "accepted",
          divertSpecialty,
          respondedAt,
          respondedBy: "Dr. Benali (Régulation)",
          smsFallbackSentAt,
          emulated: true,
          createdAt: assessedAt,
        });
      }
    }
  }

  // Insert in dependency order; update masterIncidents and dispatches on conflict so re-seeding refreshes active missions
  await db
    .insert(masterIncidents)
    .values(incidentRows)
    .onConflictDoUpdate({
      target: masterIncidents.id,
      set: {
        status: sql`excluded.status`,
        firstAlertAt: sql`excluded.first_alert_at`,
        lastAlertAt: sql`excluded.last_alert_at`,
        recSeverity: sql`excluded.rec_severity`,
        estimatedVictims: sql`excluded.estimated_victims`,
        linkedProfileIds: sql`excluded.linked_profile_ids`,
        commune: sql`excluded.commune`,
        roadRef: sql`excluded.road_ref`,
      },
    });
  await db.insert(rawAlerts).values(alertRows).onConflictDoNothing();
  await db
    .insert(dispatches)
    .values(dispatchRows)
    .onConflictDoUpdate({
      target: dispatches.id,
      set: {
        decided: sql`excluded.decided`,
        decidedAt: sql`excluded.decided_at`,
        dispatcherId: sql`excluded.dispatcher_id`,
        unitIds: sql`excluded.unit_ids`,
        modified: sql`excluded.modified`,
        modificationReason: sql`excluded.modification_reason`,
      },
    });
  await db.insert(incidentEvents).values(eventRows).onConflictDoNothing();
  await db.insert(medicAssessments).values(assessmentRows).onConflictDoNothing();
  await db.insert(handovers).values(handoverRows).onConflictDoNothing();
}
