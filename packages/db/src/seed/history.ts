import type { Database } from "../index";
import {
  dispatches,
  handovers,
  masterIncidents,
  medicAssessments,
  rawAlerts,
} from "../schema";

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
  const assessmentRows: Array<typeof medicAssessments.$inferInsert> = [];
  const handoverRows: Array<typeof handovers.$inferInsert> = [];

  for (let i = 0; i < totalIncidents; i++) {
    const pad = String(i + 1).padStart(4, "0");
    const incidentId = `00000000-0000-4000-9000-00000000${pad}`;
    const location = COMMUNE_COORDINATES[i % COMMUNE_COORDINATES.length]!;

    // Spread over 30 days: from 29 days ago up to 2 hours ago
    const daysAgo = 29 - (i * 28.5) / totalIncidents;
    const alertTimeMs = now - Math.round(daysAgo * 24 * 60 * 60 * 1000);
    const firstAlertAt = new Date(alertTimeMs);

    // Number of alerts: 1 to 3
    const alertCount = (i % 5 === 0) ? 3 : (i % 3 === 0) ? 2 : 1;
    const lastAlertAt = new Date(alertTimeMs + (alertCount - 1) * 12_000);

    // Severity distribution: red (~40%), yellow (~45%), green (~15%)
    const recSeverity = i % 10 < 4 ? "red" : i % 10 < 8 ? "yellow" : "green";

    // Rec authority: gendarmerie_nationale for highway/rural communes, surete_nationale for urban
    const recAuthority =
      location.roadRef.includes("Autoroute") || location.commune === "Zeralda" || location.commune === "Reghaïa"
        ? "gendarmerie_nationale"
        : "surete_nationale";

    const status = i < 37 ? "closed" : i === 37 ? "dispatched" : "on_scene";

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
    const assignedUnitId = UNIT_IDS[i % UNIT_IDS.length]!;

    const dispatchId = `00000000-0000-4000-9100-00000000${pad}`;
    dispatchRows.push({
      id: dispatchId,
      incidentId,
      recommended: { units: [{ type: "vsav_standard", count: 1 }] },
      decided: { units: [{ type: isModified ? "ambulance_medicalisee" : "vsav_standard", count: 1 }] },
      modified: isModified,
      modificationReason,
      unitIds: [assignedUnitId],
      authorityNotified: true,
      authorityNotifiedAt: new Date(decidedAt.getTime() + 2000),
      decidedAt,
      emulated: true,
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
            age: 25 + (i * 3) % 50,
            sex: i % 2 === 0 ? "M" : "F",
            mechanism: "Collision frontale VL / PL",
            injuries: ["Traumatisme crânien", "Contusion thoracique"],
            signs: { hr, sbp, spo2: 95, gcs: 13, shockIndex },
            treatment: ["Collier cervical", "O2 6L/min"],
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

  // Insert in dependency order with onConflictDoNothing for repeatability
  await db.insert(masterIncidents).values(incidentRows).onConflictDoNothing();
  await db.insert(rawAlerts).values(alertRows).onConflictDoNothing();
  await db.insert(dispatches).values(dispatchRows).onConflictDoNothing();
  await db.insert(medicAssessments).values(assessmentRows).onConflictDoNothing();
  await db.insert(handovers).values(handoverRows).onConflictDoNothing();
}
