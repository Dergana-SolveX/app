# SolveX 3.0 — Master Project Plan
## Problématique 1 · Accidents de la route : améliorer la réponse aux urgences

> **Working name:** `SVX Rescue` (rename freely)
> **Status:** Plan only. No code until a section is approved for expansion.
> **Flow:** Detection → Alert → Evaluation → Orientation, with a human decision at every gate.

---

## 0. Overview

### 0.1 What we are proving to the jury
The jury picked this problem for four reasons: impact, data that can be collected automatically, feasibility with smartphones, and fit with Algeria's context. The demo has to show all four in one continuous story of under 5 minutes:

1. A crash is **detected** by a car chip, a phone, or a witness on a feature phone.
2. The **alert** gets through even with no data connection (SMS / USSD).
3. The Protection Civile dispatcher sees **one merged incident** (not five duplicate calls) with an automated triage proposal, and **approves** the dispatch.
4. The medic on scene logs **Vittel criteria + vitals**. The system computes the **Shock Index** and recommends the **nearest hospital that actually has the needed specialty**. The medic confirms or overrides. The hospital gets an **AT-MIST** handover before the ambulance arrives and can **Accept / Divert**.

### 0.2 Non-negotiable rules (applied in every section)
| Rule | Concrete consequence in the code |
|---|---|
| Human-in-the-loop | No dispatch, destination change or hospital acceptance is ever written without a human action. Automated outputs are stored as `recommendation_*` fields, human choices as `decision_*` fields, and both go to the audit log. |
| Offline-first | Every Step 1 input has a non-internet path (SMS or USSD). The shared encoder is the single source of truth for that path. |
| No hospital IT dependency | Hospitals are a curated static matrix plus one toggle per specialty. Nothing integrates with an EMR. |
| Deterministic before AI | Severity comes from deterministic rules (Vittel, Shock Index, kinematics). AI only adds extracted facts (from voice and photos) that are shown and labelled as AI-derived. It can never lower a severity on its own. |

### 0.3 Corrections to the brief, built into this plan
These are worth getting right because a medical judge may check them:

- **Critères de Vittel cover more than mechanism.** The official grid (Vittel 2002) has 5 levels: (1) physiological variables, (2) kinetic elements, (3) anatomical lesions, (4) pre-hospital resuscitation, (5) patient background ("terrain"). **One positive criterion is enough** to classify the patient as severe trauma. Our *Mécanisme Lésionnel* form is level 2. Vitals feed level 1 automatically, and the pre-registered medical profile feeds level 5 automatically. Presenting it this way is clinically correct and also shows off the medical-profile feature.
- **Beta-blockers hide tachycardia,** so the Shock Index may look falsely normal. The profile's medication list must show a "SI unreliable" caveat.
- **Real SMS end to end, nothing faked.** Every SMS in the demo is a real SMS over the GSM network:
  - **Chip → server:** the chip's own GSM modem sends with AT commands (S8).
  - **Android app → server:** a custom Expo native module calls Android `SmsManager` (requires an Android development build). `expo-sms` is not enough, because it only opens the composer. iOS does not allow apps to send SMS automatically, so iOS falls back to the 1-tap composer, and we say so openly.
  - **Server side:** a real GSM USB modem plugged into the server machine, driven by our own AT-command code (`apps/gateway`). No third-party SMS cloud and no hand-written webhook calls.
  - **Server → hospital, authorities, acks:** sent through the same modem.
- **What can and cannot be real at a hackathon.** Only **USSD** strictly needs a mobile operator agreement (Mobilis / Djezzy / Ooredoo). It is built against the standard USSD-gateway callback contract and driven by an **operator emulator that is clearly labelled as such**. A **real** feature-phone path that works today is added beside it: an interactive SMS menu through the same modem. Everything else is real: sensors, GPS, SMS, and device-side Cell-ID with lookup in the OpenCelliD open database.
- **A raw UUID does not fit in the SMS.** Profiles get an 8-character opaque `short_code`. The SMS never carries medical data in clear text.
- **Geohash precision:** precision 7 is ±76 m and precision 8 is ±19 m. Since clustering works at 200 m, we use **precision 8**.
- **USSD / Cell-ID location is coarse** (≈100 m in the city, several km in rural areas). Clustering has to account for location uncertainty and cannot use a fixed 200 m for these alerts.

### 0.4 Implementation order and team split (suggested for 5 people)
```
Before : order hardware (S8 BOM) + buy SIM cards — lead time is the #1 risk
Day 0  : S1 (scaffold + schema + seed)  ─┐
         S2 (shared core, unit-tested)  ─┴─► everything depends on these
         S8 breadboard bring-up (sensors + modem talking)
Day 1  : S3 (API + gateway + realtime) │ S4 (field devices) │ S5 (dispatcher) │ S8 firmware
Day 2  : S6 (ambulance) │ S7 (hospital) │ S8 crash rig + enclosure │ demo rehearsal
```
| Owner | Sections |
|---|---|
| Backend lead | S1, S3 (incl. `apps/gateway` modem driver) |
| Clinical/core dev | S2 (+ clinical review of S6/S7 wording) |
| Embedded dev | S8 (chip hardware + firmware) |
| Mobile dev | S4 Expo app + Android SMS native module |
| Frontend dev(s) | S4 demo console, S5, S6, S7 |

---

## SECTION 1 — Monorepo Architecture & Database Schema
`packages/db` · Drizzle ORM · PostgreSQL

### 1.1 Objective & Scope
- Scaffold the Better-T-Stack monorepo and add a custom `packages/shared`.
- Define the full Drizzle schema, migrations and seed data (Algiers hospitals, ambulance units, sample medical profiles, IoT vehicles, demo urban perimeters).
- Out of scope: business logic (S2) and API procedures (S3).

### 1.2 Key Files & Packages
```
solvex/
├─ apps/
│  ├─ server/            # Hono entry: tRPC adapter, webhooks, SSE
│  ├─ web/               # React + Vite + TanStack Router + Tailwind + shadcn/ui
│  │  └─ src/routes/
│  │     ├─ console/     # S4 demo console (wire log, chip panel, feature phones, USSD emulator)
│  │     ├─ iot/         # S8.6 IoT Showcase (3D twin, block diagram, scenario triggers)
│  │     ├─ dispatcher/  # S5
│  │     ├─ ambulance/   # S6  ($unitId)
│  │     └─ hospital/    # S7  ($hospitalId)
│  ├─ native/            # Expo app (B2C victim/witness) — S4
│  │  └─ modules/svx-sms/ # custom Expo native module (Kotlin SmsManager + Cell-ID)
│  └─ gateway/           # Node process: GSM USB modem ↔ AT commands ↔ server (S3.4)
├─ firmware/             # PlatformIO (C++) ESP32 chip firmware — S8 (outside the bun workspace)
│  └─ traces/            # recorded rig traces (frontal_40, rollover, fire_parked, pothole) for S8.6 buttons + host tests
├─ hardware/             # KiCad schematic, BOM, enclosure STL, wiring photos — S8
├─ packages/
│  ├─ api/               # tRPC routers, context, services
│  ├─ db/                # Drizzle schema, migrations, seed
│  │  ├─ src/schema/*.ts
│  │  ├─ src/seed/{hospitals,units,profiles,vehicles,zones}.ts
│  │  └─ drizzle.config.ts
│  └─ shared/            # pure TS, zero runtime deps except zod (S2); also ChipTelemetry/ChipEvent/ChipCommand schemas (S8.6)
│     └─ test-vectors/   # svx.json, consumed by vitest and PlatformIO native tests
├─ docker-compose.yml    # web + server only; the database is Neon (DATABASE_URL direct, DATABASE_URL_POOLED runtime)
└─ turbo.json
```
Scaffold command (pin the version when we run it):
`bun create better-t-stack@latest solvex-dergana --frontend tanstack-router native-uniwind --backend hono --runtime bun --database postgres --orm drizzle --api trpc --auth better-auth --addons turborepo` (already run; see `bts.jsonc`)
Then add `packages/shared` by hand and register it in the workspace and `tsconfig` paths.

> Note: the brief's `apps/web/dispatcher` is implemented as **routes** inside `apps/web` (one Vite app, one deploy, shared components). It is not a separate folder or app.

### 1.3 Schema (tables, key columns, enums)

**Enums:** `alert_source` (`iot`, `app_auto`, `app_witness`, `ussd`) · `alert_channel` (`internet`, `sms`, `ussd`) · `severity` (`red`, `yellow`, `green`, `unknown`) · `incident_status` (`open`, `dispatched`, `on_scene`, `transporting`, `handed_over`, `closed`, `false_alarm`) · `unit_type` (`vsav_standard`, `ambulance_medicalisee`, `desincarceration`) · `authority` (`surete_nationale`, `gendarmerie_nationale`) · `hospital_tier` (`chu`, `ehs`, `eph`, `epsp_polyclinic`) · `handover_status` (`pending`, `accepted`, `diverted`).

| Table | Purpose | Key columns |
|---|---|---|
| `medical_profiles` | Pre-registered victim data | `id uuid`, `short_code char(8) unique` (SMS-safe), `full_name`, `birth_date`, `sex`, `blood_type`, `chronic_conditions text[]`, `allergies text[]`, `medications jsonb` (`[{name, class: 'anticoagulant'|'beta_blocker'|'insulin'|...}]`), `pregnancy_status`, `emergency_contact`, `consent_at timestamptz` (required, Law 18-07), `updated_at` |
| `vehicles` *(supporting)* | B2B IoT chip ↔ vehicle ↔ owner | `id`, `device_id unique`, `device_secret_hash` (HMAC key, S8), `sim_msisdn` (registered SIM, used to authenticate SMS), `firmware_version`, `last_heartbeat_at`, `battery_mv`, `last_telemetry jsonb`, `plate`, `make_model`, `fleet_name`, `owner_profile_id → medical_profiles` |
| `cell_towers` *(supporting)* | Cell-ID → location | `mcc`, `mnc`, `lac`, `cid` (composite PK), `lat`, `lng`, `range_m`, `source ('opencellid'|'survey')`. Imported from the OpenCelliD export for MCC 603 (Algeria) and topped up by our own survey (S4) |
| `device_commands` *(supporting, S8.6)* | Signed commands from the IoT Showcase to the chip, audited | `id`, `device_id`, `seq` (replay protection, unique per device), `cmd` (`inject_trace`, `force_channel`, `arm`, `selftest`), `args jsonb`, `hmac`, `status ('queued'|'delivered'|'acked'|'timeout')`, `issued_by`, `issued_at`, `acked_at`, `result jsonb` |
| `sms_log` *(supporting)* | Every real SMS in/out through the modem | `id`, `direction`, `msisdn_hash`, `body`, `modem_ref`, `status ('received'|'queued'|'sent'|'delivered'|'failed')`, `at` |
| `master_incidents` | One real-world crash | `id`, `lat`, `lng`, `geohash8`, `location_uncertainty_m`, `first_alert_at`, `last_alert_at`, `confidence_score numeric(0..1)`, `alert_count`, `status`, `rec_severity`, `rec_units jsonb`, `rec_authority`, `ai_summary jsonb` (labelled), `vittel_prefill jsonb`, `linked_profile_ids uuid[]`, `estimated_victims`, `pk_marker`, `commune`, `road_ref` |
| `raw_alerts` | Every incoming signal, never mutated | `id`, `incident_id → master_incidents (nullable until clustered)`, `source`, `channel`, `received_at`, `event_at` (device time; may be earlier than received for queued SMS), `lat`, `lng`, `geohash`, `accuracy_m`, `g_force`, `delta_v_kmh`, `rollover_deg`, `fire`, `victims`, `conscious`, `trapped`, `bleeding`, `profile_id`, `vehicle_id`, `raw_payload text` (exact SMS/USSD string), `media jsonb` (photo URLs, audio URL), `transcript`, `transcript_lang`, `parse_errors jsonb`, `sender_msisdn_hash`, `emulated bool`, `trace_injected bool`, `impacts int`, `saturated bool` |
| `hospitals_matrix` | Static capabilities + live status | `id`, `name`, `short_name`, `tier`, `commune`, `wilaya`, `lat`, `lng`, `phone`, `cap_neurosurgery`, `cap_ct_scanner`, `cap_burn_unit`, `cap_icu`, `cap_trauma_surgery`, `cap_pediatric`, `cap_obstetrics`, `cap_blood_bank`, `cap_stabilization_only`, `status jsonb` (`{neurosurgery:'accept'|'divert', ...}`), `status_updated_at`, `status_updated_by` |
| `ambulance_units` *(supporting)* | Protection Civile fleet | `id`, `call_sign`, `type`, `base_name`, `lat`, `lng`, `available bool` |
| `dispatches` | Dispatcher decision for an incident | `id`, `incident_id`, `recommended jsonb` (units + authority + severity as proposed), `decided jsonb` (as approved), `modified bool`, `modification_reason`, `dispatcher_id`, `decided_at`, `unit_ids uuid[]`, `authority_notified`, `authority_notified_at` |
| `medic_assessments` | Bilan secouriste per victim | `id`, `incident_id`, `dispatch_id`, `unit_id`, `victim_index`, `profile_id (nullable)`, `est_age`, `sex`, `vittel jsonb` (5 levels, each item `{value, source: 'iot'|'app'|'medic'}`), `gcs`, `hr`, `sbp`, `dbp`, `spo2`, `rr (optional)`, `shock_index` (computed, stored), `suspected_injuries text[]`, `treatments text[]`, `rec_hospital_id`, `rec_ranking jsonb`, `chosen_hospital_id`, `override_reason`, `eta_minutes`, `assessed_at` |
| `handovers` *(supporting)* | AT-MIST sent to a hospital | `id`, `assessment_id`, `hospital_id`, `atmist jsonb` (frozen snapshot), `status`, `responded_at`, `responded_by`, `divert_specialty`, `created_at` |
| `incident_events` *(supporting, audit)* | Who did what, when | `id`, `incident_id`, `actor_role`, `actor_id`, `type` (`alert_merged`, `dispatch_approved`, `destination_override`, `hospital_divert`, …), `payload jsonb`, `at` |
| `zones` *(supporting)* | Urban perimeters for Police vs Gendarmerie | `id`, `name`, `kind ('urban_perimeter')`, `polygon jsonb` (GeoJSON) |
| `users` *(supporting, demo auth)* | Role-based demo logins | `id`, `name`, `role ('dispatcher'|'medic'|'hospital'|'admin')`, `unit_id`, `hospital_id` |

**Indexes:** `raw_alerts(received_at)`, `master_incidents(status, last_alert_at)`, `master_incidents(lat, lng)` (bounding-box prefilter), `medical_profiles(short_code)`, `vehicles(device_id)`.
**PostGIS:** optional. The plan works without it (haversine + bbox in app code). It becomes worth adding if we later need real road-distance queries.

### 1.4 Seed data specification
- **Hospitals (Algiers, ~10–12 rows).** Real names. **Coordinates and capabilities must be checked by a team member before the demo** and labelled "données de démonstration" in the UI. Candidates: CHU Mustapha Pacha, CHU Bab El Oued (Lamine Debaghine), CHU Beni Messous (Isaad Hassani), CHU Hussein Dey (Nafissa Hamoud / ex-Parnet), EHS Salim Zemirli (El Harrach, traumatology), EHS Ali Aït Idir (neurosurgery), a burn-centre reference (to confirm which facility Algiers actually routes burns to), 2–3 EPH (e.g., Rouiba, Bologhine, Ain Taya) and 2–3 EPSP polyclinics marked `cap_stabilization_only`.
- **Ambulance units:** 6–8 units spread over Algiers Protection Civile units, mixing all 3 `unit_type`s.
- **Profiles (5),** each built to trigger a demo story:
  1. 72 y/o on **anticoagulant** (AVK/apixaban) → hemorrhage risk + Vittel level 5.
  2. Type 1 diabetic on **insulin** → "check capillary glucose" tag.
  3. Hypertensive on **beta-blocker** → "Shock Index may underestimate" caveat.
  4. Pregnant, 3rd trimester → Vittel level 5 + obstetrics capability required.
  5. Healthy 25 y/o, **O−** → baseline.
- **Vehicles:** 3 fleet vehicles linked to profiles 1, 3 and 5.
- **Zones:** 3–4 hand-drawn urban perimeter polygons (e.g., Alger-Centre, Bab Ezzouar, Rouiba) for the authority routing demo.
- **Users:** 1 dispatcher, 2 medics, 1 user per seeded hospital.

### 1.5 Data flow & edge cases
- `raw_alerts` is **append-only**. Clustering only sets `incident_id`, and a dispatcher "split" re-points rows. This keeps the evidence chain intact.
- A queued SMS arriving late has `event_at` ≪ `received_at`. Clustering uses `event_at` when it is present and trusted (clock-skew sanity check of ±24 h).
- A profile can be deleted (right to erasure). Alerts keep `profile_id` nullable with `on delete set null`.
- Multiple victims mean one incident and N `medic_assessments`, with N handovers possibly going to different hospitals.
- Demo auth stays deliberately simple (role picker + seeded users). Hardening is listed as future work.

### 1.6 Implementation checklist
- [ ] Run the Better-T-Stack scaffold, verify `turbo dev` boots web + server + native
- [x] Add `packages/shared` (tsconfig, build/exports, vitest)
- [x] `.env.example` (database is Neon; the local Postgres service in `docker-compose.yml` is unused)
- [x] Write enums + 15 tables in `packages/db/src/schema/` (13 plan tables + `device_commands` + `app_users`; Better Auth keeps its own 4)
- [x] Relations (`drizzle-orm` `relations()`), indexes
- [x] `drizzle-kit generate` + `migrate` scripts in `package.json`
- [x] Seed scripts (idempotent, `bun run db:seed`, `bun run db:reset`)
- [ ] Verify hospital coordinates and capabilities manually; record the sources in `packages/db/src/seed/SOURCES.md`
- [x] Export inferred types (`$inferSelect`) for API consumption

---

## SECTION 2 — Shared Core & Clinical Engine
`packages/shared` · pure TypeScript, no I/O, 100% unit-tested

### 2.1 Objective & Scope
All logic that must behave **identically** on phone, server and web lives here, as pure functions: encoding, geo math, clustering decisions, triage, hospital matching, AT-MIST building. No DB or network access. That makes it trivially testable and lets the Expo app use it offline.

### 2.2 Key files
```
packages/shared/src/
├─ schemas/            # zod: RawAlertInput, WitnessForm, IotTelemetry, MedicAssessment, AtMist…
├─ sms/protocol.ts     # encode/decode SVX v1
├─ sms/crc8.ts
├─ geo/geohash.ts      # encode/decode/neighbors
├─ geo/haversine.ts
├─ geo/pointInPolygon.ts
├─ cluster/cluster.ts  # shouldMerge(), confidence()
├─ triage/kinematics.ts# prefill Vittel level 2 from IoT/app data
├─ triage/vittel.ts    # 5-level evaluation
├─ triage/shockIndex.ts
├─ triage/severity.ts  # RED/YELLOW/GREEN + unit recommendation
├─ triage/profileRisk.ts
├─ routing/authority.ts# Police vs Gendarmerie
├─ hospital/matcher.ts
├─ atmist/builder.ts
├─ i18n/labels.ts      # FR / AR / Darja-friendly labels for clinical terms
└─ index.ts
```

### 2.3 Module specs

**A. SMS Compact Protocol `SVX` v1.** It keeps the brief's format and adds versioning, a timestamp and a checksum.
```
SVX1#L:2#GH:sn2j5x7k#T:k3f9zq#G:8.5#R:1#FIRE:0#V:2#C:1#TR:1#B:0#UID:K7Q2M9XA#CK:3F
```
| Key | Meaning | Notes |
|---|---|---|
| `SVX1` | magic + version | lets us evolve the format |
| `L` | layer 1=IoT, 2=app, 3=USSD-originated relay | |
| `GH` | geohash precision 8 | ±19 m |
| `T` | event time, epoch **minutes** in base36 | queued SMS keep their true crash time |
| `G` | peak g, 1 decimal | omitted for witness reports |
| `R` | rollover 0/1 | |
| `FIRE`,`V`,`C`,`TR`,`B` | fire, victims (0–9, `9` = 9+), conscious (0/1/2 = unknown), trapped, bleeding | |
| `UID` | profile short_code | opaque, no medical data |
| `DV` | delta-V km/h (chip only) | |
| `CI` | serving cell `mcc-mnc-lac-cid` (hex) | location fallback when there is no GPS fix (tunnel, cold start) |
| `H` | first 6 base32 chars of HMAC-SHA256(device_secret, message) | **chip only.** Authenticates the device; the CRC does not protect against spoofing |
| `CK` | CRC-8 hex over everything before `#CK` | detects corruption and truncation |

- **Cross-language conformance:** `packages/shared/test-vectors/svx.json` (inputs → exact SMS strings, plus corrupted cases) is consumed by **both** vitest (TypeScript) and the PlatformIO unit tests (C++ firmware). CI fails if the two encoders ever disagree, which gives the technical jury hard proof that both ends speak the same protocol.

- Character set is **GSM-7 only** (no accents), so it stays a single SMS segment of ≤160 chars. Target ≤140.
- The decoder is tolerant: unknown keys are ignored, missing optional keys become `null`, and a bad CRC still ingests the alert with `parse_errors` set and confidence downgraded. We never drop a distress signal.
- Tests: round-trip property tests, max-length test, fuzzed corruption.

**B. Geo.** Geohash encode/decode/neighbors (own implementation, ~60 lines, or `ngeohash`), haversine (m), bounding box, point-in-polygon (ray casting) for zones.

**C. Spatiotemporal clustering** `shouldMerge(alert, incident)`:
- Time: `|alert.event_at − incident.last_alert_at| ≤ 10 min` (a **sliding** window, so a long incident keeps absorbing reports).
- Distance: `haversine ≤ 200 m + min(alert.accuracy_m, incident.uncertainty_m, 3000)`. A coarse USSD alert can attach to a precise incident, but then the match is marked **"tentative"** for the dispatcher to confirm.
- If several incidents match, pick the nearest.
- `confidence()` = 1 − Π(1 − wᵢ) over the alerts, with weights IoT 0.6, app-auto 0.45, app-witness 0.4, USSD 0.3. A bonus applies when the sources are independent (different layers or senders).
- Known limitation (documented in the UI): two separate crashes on opposite carriageways within 200 m will merge. Mitigation: the dispatcher's **Split** action (S5), plus a heading-difference hint when IoT gives a heading.

**D. Kinematics → Vittel level 2 prefill.**
- `g_force ≥ 4` and `delta_v ≥ 30 km/h` → "high-energy impact (évaluation globale)".
- `rollover ≥ 90°` → "tonneaux".
- `fire` → also prefill the level 3 item "brûlure / inhalation de fumées" as *suspected*.
- Witness "trapped" → "victime incarcérée".
- Every prefilled item carries `source` so the medic UI can show "pré-rempli par capteur, à confirmer".
- Phone false positives: the phone layer requires `peak ≥ 4 g` **and** speed ≥ 25 km/h in the previous 10 s (GPS) **and** < 5 km/h afterward. A dropped phone fails the speed test.

**E. Vittel evaluator** `evaluateVittel(input) → { severe: boolean, positives: Criterion[] }`:
1. Physiological: GCS < 13, SBP < 90, SpO2 < 90%.
2. Kinetic: ejection, death in same vehicle, fall > 6 m, victim thrown or crushed, global assessment (deformation, estimated speed, no seatbelt/helmet), blast.
3. Anatomical: penetrating trauma of head/neck/thorax/abdomen/arm/thigh, flail chest, severe burn or smoke inhalation, pelvic fracture, suspected spinal injury, amputation proximal to wrist or ankle, acute limb ischaemia.
4. Pre-hospital resuscitation: assisted ventilation, fluid > 1000 ml, catecholamines, pneumatic anti-shock garment.
5. Terrain: age > 65, cardiac/coronary insufficiency, respiratory insufficiency, pregnancy (T2–T3), coagulation disorder (**auto-filled from profile anticoagulants**).

All label strings are in French with Arabic translations in `i18n`. The exact wording gets a clinical review pass before the demo.

**F. Shock Index** `shockIndex(hr, sbp)`:
- Returns `{ value, flag: 'normal' | 'elevated' (>0.9) | 'critical' (≥1.3), caveats[] }`.
- Edge cases:
  - SBP = 0 or unmeasurable → `critical` with "PAS imprenable".
  - Missing HR or SBP → `null` (never 0).
  - Beta-blocker in profile → caveat "peut sous-estimer le choc".
  - Pediatric (< 12 y) → caveat "seuils adultes non applicables".
  - Pregnancy → caveat.

**G. Severity & unit recommendation** (initial triage, before any medic is on scene):
- RED: any of (Vittel kinetic positive and conscious = 0) · fire · trapped · victims ≥ 3 · IoT `g ≥ 8` · profile-risk HIGH with `g ≥ 4`.
- YELLOW: a kinetic positive alone, a bleeding report, or a high-risk profile.
- GREEN: low g, everyone conscious, no flags.
- UNKNOWN: insufficient data. This is shown as such and never defaults to green.
- Units: RED → medicalised ambulance (+ désincarcération if trapped or rollover; + additional VSAV if victims ≥ 3). YELLOW → VSAV. GREEN → VSAV with lower priority.
- Output includes a human-readable `reasons[]` for every recommendation (explainability for the dispatcher and the jury).

**H. Profile risk** `profileRisk(profile) → { level, flags[], prepTags[] }`:
- Anticoagulant → HIGH, "risque hémorragique interne", prep tag "bilan de coagulation / antidote".
- Insulin → "glycémie capillaire".
- Allergies → listed verbatim.
- Blood type → prep tag "préparer culots {type} / O−".

**I. Authority routing** `routeAuthority(lat, lng, zones, roadRef?)`: inside an urban perimeter polygon → Sûreté Nationale (17 / 1548). Otherwise, or on a national road/autoroute outside a perimeter → Gendarmerie Nationale (1055). The rule is configurable, and the default needs validating with someone familiar with the actual jurisdiction split.

**J. Hospital matcher** `matchHospitals(needs, hospitals, origin) → Ranked[]`:
1. `deriveNeeds(assessment, profile)`:
   - GCS ≤ 13 or head trauma → neurosurgery + CT
   - burn or smoke → burn unit
   - Shock Index > 0.9 or SBP < 90 → trauma surgery + blood bank + ICU
   - spinal injury → neurosurgery + CT
   - pregnancy → obstetrics
   - age < 15 → pediatric preferred
   - polytrauma → trauma surgery + ICU + CT
2. **Hard filter:** the hospital has *all* required capabilities and none of the needed specialties is in `divert`.
3. **Rank** by ETA = haversine × 1.4 road factor ÷ 50 km/h (urban) or 80 km/h (highway). Optional upgrade: OSRM.
4. **Fallback:** if nothing matches, return the nearest partial match, flagged `secondary_transfer_risk`, together with the nearest stabilization facility. Polyclinics are only recommended for GREEN, or as "stabilize first" when the best match's ETA exceeds 45 min **and** the patient is in shock (the trade-off is shown explicitly).
5. Each result carries `matched[]`, `missing[]` and `eta_min` for display.

**K. AT-MIST builder** `buildAtMist(incident, assessment, profile, dispatch) → AtMist`. It builds a structured object plus a plain-text rendering for SMS fallback:
- **A**ge/Antécédents: age, sex, blood type, anticoagulants, allergies, pregnancy.
- **T**ime: crash time + ETA.
- **M**echanism: confirmed Vittel level 2 items.
- **I**njuries: suspected injuries (Vittel level 3).
- **S**igns: GCS, FC, PAS/PAD, SpO2, SI badge.
- **T**reatment: treatments given + `prepTags` (e.g., "Préparer scanner + culots O−").

The SMS rendering stays ≤ 3 segments, so a hospital with only a phone still gets the handover.

### 2.4 Implementation checklist
- [ ] Zod schemas (single source for API input validation and form validation)
- [ ] SMS protocol + CRC-8 + property tests
- [ ] Geohash, haversine, point-in-polygon + tests against known Algiers coordinates
- [ ] `shouldMerge` + `confidence` + table-driven tests (including USSD uncertainty)
- [ ] Kinematics prefill + phone false-positive filter
- [ ] Vittel evaluator + Shock Index with all edge cases
- [ ] Severity + unit recommendation with `reasons[]`
- [ ] Profile risk, authority routing
- [ ] Hospital matcher (+ fallback paths) + AT-MIST builder + text rendering
- [ ] FR/AR label dictionary; clinical review of wording
- [ ] `vitest --coverage` ≥ 90% on `triage/`, `sms/`, `cluster/`, `hospital/`

---

## SECTION 3 — Hono + tRPC Backend, AI Pipeline & Real-Time Events
`apps/server` · `packages/api`

### 3.1 Objective & Scope
- Ingest alerts from all channels.
- Cluster them, triage them and persist everything.
- Expose type-safe procedures to every view.
- Push live updates to the Dispatcher, Ambulance and Hospital screens.
- Run the optional AI enrichment (voice and photos) asynchronously, without blocking the alert.

### 3.2 Key files
```
packages/api/src/
├─ context.ts            # db, user/role, eventBus
├─ trpc.ts               # router, publicProcedure, roleProcedure(role)
├─ routers/
│  ├─ alerts.ts          # submitOnline, (internal) ingestSms, ingestUssd
│  ├─ incidents.ts       # list, byId, split, merge, markFalseAlarm, onChange (subscription)
│  ├─ dispatch.ts        # recommendation(incidentId), approve(...)
│  ├─ assessments.ts     # upsert, recommendHospitals, confirmDestination
│  ├─ hospitals.ts       # list, setStatus, respondHandover, onHandover (subscription)
│  ├─ profiles.ts        # register, byShortCode (role-gated)
│  └─ simulator.ts       # iotTelemetry, injectCellId, resetDemo
├─ services/
│  ├─ ingest.ts          # normalize → persist raw → cluster → triage → emit
│  ├─ clustering.ts      # DB query (bbox prefilter) + shared.shouldMerge
│  ├─ triage.ts          # shared severity + profileRisk + authority
│  ├─ ai/stt.ts          # provider interface + implementations
│  ├─ ai/vision.ts
│  ├─ ai/enrich.ts       # job: transcript/photo → structured facts
│  └─ events.ts          # typed EventEmitter bus
apps/server/src/
├─ index.ts              # Hono app, CORS, tRPC mount (/trpc), static media
├─ webhooks/sms.ts       # POST /webhooks/sms
├─ webhooks/ussd.ts      # POST /webhooks/ussd (session state machine)
└─ media.ts              # POST /media (multipart → local disk/S3-compatible)
```

### 3.3 Ingestion pipeline (all channels converge)
```
IoT (tRPC) ─┐
App online ─┼─► normalize(RawAlertInput) ─► INSERT raw_alerts ─► cluster ─► triage ─► UPDATE master_incidents
SMS webhook ┤                                   │                                      │
USSD webhook┘                                   └─► enqueue AI enrich (if media)       └─► emit incident.updated
```
- The pipeline is **idempotent.** Each message gets a dedupe key (`sha1(raw_payload + sender_hash)` for SMS, `device_id + event_at` for IoT), so retries from flaky networks do not create duplicate alerts.
- Clustering runs inside a transaction with `SELECT … FOR UPDATE` on candidate incidents. This avoids two concurrent alerts each creating a new incident (a race that becomes real when 5 witnesses report at once).
- Re-triage happens on every merge: the recommendation is recomputed, but a **dispatcher's decision is never overwritten.** If new data raises severity after a dispatch, the server emits `incident.escalation_suggested` instead.

### 3.4 Real SMS gateway, device endpoint & USSD
**A. `apps/gateway`: our own SMS gateway over a real GSM modem (no faking, no third-party SMS cloud)**
- Hardware: a USB GSM modem (SIM7600 USB dongle, or a second SIM800/SIM7600 board + USB-UART) with an Algerian SIM. Its number is the "SVX number" that phones and chips text.
- Code: Node + `serialport`. A small AT-command driver we write ourselves:
  - init: `AT`, `AT+CMGF=1` (text mode), `AT+CNMI=2,1` (new-message notifications), `AT+CSCS="GSM"`
  - on `+CMTI` → `AT+CMGR=<idx>` → parse → `AT+CMGD=<idx>`
  - send: `AT+CMGS` with delivery reports (`AT+CSMP`)
  - a single serial command queue with timeouts
  - reconnect on USB unplug
  - startup sweep of unread messages (`AT+CMGL="REC UNREAD"`) so nothing received while the gateway was down is lost
- Flow: received SMS → `sms_log` → `POST /internal/sms` (shared-secret auth) → ingest pipeline → **ack SMS sent back** (`SVXACK#<incident ref>`). The chip and app stop retrying when the ack arrives.
- Outbound uses: acks, interactive SMS menu replies, AT-MIST SMS fallback to hospitals, authority notification.
- Unit tests drive the AT driver against a recorded modem transcript (a fixture of real modem output, not a fake success path).
- Production path: same `/internal/sms` contract behind an operator SMS-C / short-code agreement. Only the gateway adapter changes.

**B. Device endpoint (chip online path):** `POST /devices/:deviceId/events` (plain Hono REST, since the firmware does not speak tRPC).
- Header `X-SVX-Signature: HMAC-SHA256(device_secret, body)` plus a timestamp. Replays outside ±5 min are rejected.
- Heartbeats (`/devices/:deviceId/heartbeat`, every 60 s when online): battery, GPS fix, signal, firmware version.
- SMS from a chip is authenticated by sender MSISDN = `vehicles.sim_msisdn` **and** the `H` field. A mismatch is still ingested but marked "unauthenticated" with lower confidence (we never drop a distress signal).

**C. Feature phones, two paths:**
- **Real today: interactive SMS menu.** Texting `ACCIDENT` (or `حادث`) to the SVX number starts a session keyed by MSISDN:
  1. "Combien de victimes ? 1 / 2 / 3"
  2. "Conscientes ? 1 Oui 2 Non 3 Ne sait pas"
  3. "Danger ? 1 Feu 2 Coincé 3 Saignement 4 Aucun"
  4. "Commune ou PK ?"

  Each reply goes through the real modem. Location comes only from the typed commune/PK, which is geocoded against a commune table (the network does not give us the sender's Cell-ID, and we say so).
- **USSD (`*140#`), operator-ready.** `POST /webhooks/ussd` implements the widely used USSD-aggregator HTTP callback convention (`sessionId, serviceCode, phoneNumber, text` = `*`-joined inputs; response prefixed `CON` / `END`). Plugging in a real operator becomes a configuration change. On stage it is driven by an **"Operator emulator"** panel that is explicitly labelled as such. Server-side state machine:
  1. Welcome
  2. Victims (1 / 2 / 3+)
  3. Conscious (Oui / Non / Ne sait pas)
  4. Danger (Feu / Incarcéré / Saignement / Aucun)
  5. Optional PK or commune
  6. Confirmation

  On a real operator, the network supplies the Cell-ID in the callback. In the emulator, the Cell-ID is taken from a **real** tower in `cell_towers` (OpenCelliD) near the chosen point. It is resolved through the same `cellId → lat, lng, range_m` lookup that the chip and the app use. The PK is stored as text and shown to the dispatcher. Sessions time out at 120 s, as real USSD does, with a partial save that ingests whatever was answered.

### 3.5 AI pipeline (non-blocking, labelled, can be switched off)
- **STT:** behind a provider interface `transcribe(audio, hintLangs: ['ar-DZ','fr','ar'])`. Implementation: a Whisper-class model (hosted API or a local `whisper.cpp` build).
  - Darja accuracy is the main risk. Mitigations: show the raw transcript with a confidence score, keep the audio playable for the dispatcher, and prepare 2–3 demo recordings tested in advance.
- **Extraction and vision:** the transcript and photos go to an LLM with a **strict JSON schema output**: `{victims?, trapped?, fire?, bleeding?, vehicle_count?, vehicle_deformation?: 'none'|'moderate'|'severe', hazards[], quotes[]}`. Recommended: a Claude model (e.g., `claude-sonnet-5-5`) for photo + text understanding. The provider is swappable through env config.
- **Guardrails:**
  - AI facts are merged as a separate `ai_summary` with `source: 'ai'`.
  - Rule: AI can **raise** a severity *suggestion* but never lower it.
  - Everything is labelled "Suggestion IA — à vérifier" in the UI.
  - On timeout (8 s) or error, the incident proceeds without AI and the failure is logged.
  - No AI call is made for SMS/USSD alerts (no media).
- **Privacy:** photos may show faces and plates, so access goes through signed URLs and retention is limited.

### 3.6 Real-time channels
- Use **tRPC v11 subscriptions over SSE** (`httpSubscriptionLink`) for end-to-end typing. SSE also recovers better on mobile networks than WebSockets (automatic reconnection + `lastEventId` resume).
- Event bus: in-process typed `EventEmitter` (single server instance for the hackathon). Production upgrade path: Postgres `LISTEN/NOTIFY` or Redis.

| Channel | Subscribers | Events |
|---|---|---|
| `dispatcher` | all dispatchers | `incident.created`, `incident.updated`, `alert.merged`, `incident.escalation_suggested`, `ai.enriched` |
| `unit:{id}` | one ambulance | `dispatch.assigned`, `handover.accepted`, `handover.diverted` (+ next best hospital) |
| `hospital:{id}` | one hospital | `handover.incoming`, `handover.updated` (ETA / vitals refresh), `handover.cancelled` |

- On reconnect, clients refetch a snapshot and then resume the stream, so no state is lost after a disconnect.
- Hospital fallback: if the hospital board has not acknowledged within 60 s, the server sends the AT-MIST **SMS rendering** to the hospital phone number as a **real SMS through `apps/gateway`**. In the demo, seeded hospital numbers point to a teammate's phone.

### 3.7 Implementation checklist
- [ ] Context with role (demo header/cookie), `roleProcedure`
- [ ] `ingest.ts` pipeline with dedupe + transactional clustering
- [ ] Routers: alerts, incidents (incl. split/merge), dispatch, assessments, hospitals, profiles, simulator
- [ ] `apps/gateway`: AT-command driver (queue, timeouts, `+CMTI`, unread sweep, delivery reports, reconnect) + recorded-transcript tests
- [ ] `/internal/sms` ingest + shared decoder + error tolerance + ack SMS
- [ ] Device endpoints: HMAC verification, replay window, heartbeat, MSISDN + `H` auth for SMS
- [ ] Interactive SMS menu state machine (FR/AR keywords) + commune geocoding table
- [ ] USSD callback (`CON`/`END` contract) + timeout handling + labelled operator emulator
- [ ] OpenCelliD import script for MCC 603 → `cell_towers`; shared `resolveCell()` lookup
- [ ] Media upload endpoint (size/type limits)
- [ ] AI provider interfaces, Whisper + LLM implementations, JSON-schema validation of AI output, timeout + kill switch (`AI_ENABLED=false`)
- [ ] Event bus + 3 subscription procedures + reconnect snapshot
- [ ] Audit log writes on every human decision
- [ ] Hospital ack timeout → SMS fallback (simulated)
- [ ] `simulator.resetDemo` to restore seed state between rehearsals
- [ ] Integration tests: 5 concurrent alerts → 1 incident; late SMS; bad CRC

---

## SECTION 4 — Field Devices & Demo Console (Steps 1 & 2 live)
`apps/native` · `apps/web/src/routes/console` · (chip itself: S8)

### 4.1 Objective & Scope
Show detection and alerting **with real devices on stage**:
- the S8 chip on a crash rig
- the Expo app on a physical Android phone (real sensors, real SMS)
- a basic feature phone using the real SMS menu

The web **Demo Console** does not generate fake alerts. It **observes**: it shows what the devices actually sent and what the modem actually received, so the jury can follow every byte.

**Honesty rule:** anything that is not real (the USSD operator emulator, and replays of recorded sensor traces used for testing) carries a permanent `ÉMULATION` badge in the UI and an `emulated: true` flag in the stored alert.

### 4.2 Console layout
Split view:
- left = device panels
- right = **Wire log**: chronological list of real traffic, read from `sms_log`, device events and the ingest pipeline, with channel badges INTERNET / SMS / USSD, byte size, delivery status, and decode result (CRC/HMAC ✓/✗)

Global controls: "Reset demo" (restores the DB seed only; it never fabricates traffic).

### 4.3 Panel 1 — B2B Chip live view (hardware in S8)
- Live telemetry from the real chip: heartbeats over 4G. When the chip is plugged in over USB, the **Web Serial API** (Chrome) streams the firmware log live (state machine transitions, raw g samples, AT commands).
- Live g-force chart (last 5 s ring buffer), roll/pitch gauge, GPS fix + satellites, signal strength, battery, smoke/flame readings.
- Shows which channel the chip used (4G or SMS). The "No data" demo is done **physically**: pull the antenna or remove the SIM's data plan (APN), not with a UI toggle.
- **Trace replay** (for development and as a stage backup): replays a *recorded* real crash trace into the firmware detection algorithm, compiled for the host (same C++ code, native PlatformIO test build). Always badged `ÉMULATION`.

### 4.4 Tab 2 — Mobile App (Expo, on a physical Android phone; web phone-frame mirror as backup)
**Victim mode (auto-detect):**
- `expo-sensors` accelerometer at ~50 Hz and `expo-location` speed feed the shared false-positive filter.
- On trigger: full-screen red countdown (15 s), loud alarm (`expo-av`), vibration, and a giant **"JE VAIS BIEN — ANNULER"** button.
- Demo aid: a hidden "simulate impact" button, because we will not crash a phone on stage.
- When the countdown expires:
  - online → tRPC `alerts.submitOnline`
  - offline → encode SVX → **custom Expo module `svx-sms`** (Kotlin, `SmsManager.sendTextMessage` with sent/delivered `PendingIntent`s, runtime `SEND_SMS` permission) sends automatically to the SVX number, then waits for the `SVXACK` reply (`RECEIVE_SMS`).
  - The same module reads the **serving Cell-ID** (`TelephonyManager.getAllCellInfo`) and adds `CI:` when GPS has no fix.
  - Requires an **Android development build** (`expo prebuild` + local/EAS build), not Expo Go.
  - iOS: Apple forbids automatic SMS, so it falls back to the `expo-sms` composer (1 tap).
  - Production note for the pitch: Google Play restricts `SEND_SMS` permission, so distribution goes through a Play policy exception for emergency use, enterprise/MDM distribution for fleets, or an operator-integrated build.
- Limitations stated honestly in the pitch:
  - Detection works with the app in the foreground or as an Android foreground service (stretch). The OS restricts background sensor access.
  - Phone accelerometers saturate at ~8–16 g, so values are a lower bound.

**Witness mode, the 3-Tap form:**
- Huge buttons, one question per screen, icons + FR/AR text:
  1. Victims 1 / 2 / 3+
  2. Conscious / moving? Oui / Non / Je ne sais pas
  3. Danger: Feu / Coincé / Saignement / Aucun (multi-select)
- GPS from the offline satellite chip (`expo-location`, no network needed). If there is no fix within 20 s → "Où êtes-vous ?" quick PK/commune text field.
- Online extras: up to 3 photos (`expo-image-picker`, compressed to ~200 KB) and a 30 s voice note (`expo-av`). The upload happens **after** the core alert is sent, so a slow upload never delays the alert.

**Offline outbox:** alerts are stored in `AsyncStorage` until an ack arrives. Retry runs on connectivity change (`@react-native-community/netinfo`). If online submission fails twice → SMS fallback.

**Raw SMS preview panel:** shows the exact `SVX1#…` string + character count.

**Profile registration screen** (consent checkbox, Law 18-07 wording). It shows the user their `short_code`.

### 4.5 Panel 3 — Feature phones
- **Real path:** a teammate's basic feature phone texts `ACCIDENT` to the SVX number and answers the SMS menu (S3.4-C). The console shows the conversation as it arrives from the modem.
- **USSD `*140#` (operator emulator, badged `ÉMULATION`):** a feature-phone mockup drives the real server USSD callback. The Cell-ID comes from a real OpenCelliD tower near the chosen point, and its coverage circle is drawn on the map, which shows the uncertainty. Pitch note: `*140#` is illustrative. A real short code would be assigned by the operator or ARPCE.
- **Cell survey (bonus, real data):** the Android app's "survey" screen logs `(Cell-ID, GPS)` pairs while the team moves around. This fills gaps in OpenCelliD coverage of Algeria with our own measured data (`source = 'survey'`).

### 4.6 Demo scenarios (all real devices)
1. **"Autoroute Est-Ouest, zone rurale"** (Gendarmerie):
   - the **chip on the crash rig** (fleet car, profile #1, anticoagulant) sends by real SMS with its antenna data disabled
   - 40 s later, a witness 3-Tap on the Android phone in airplane-mode-with-SMS (fire), sent as a real SMS
   - a feature-phone SMS-menu report
   - → **1 incident, 3 alerts, high confidence**
   - Location note: the GPS fix is recorded beforehand outdoors, or a fixed "demo position" is configured in firmware and **shown as such**. GPS does not work indoors.
2. **"Bab Ezzouar, zone urbaine"** (Police): online witness with photo + Darja voice note.
3. **False alarm:** phone shaken/dropped → countdown → cancelled → nothing reaches the dispatcher. The chip's false-positive filter is shown on the serial log.

### 4.7 Edge cases
- Countdown cancelled at 14.9 s → no alert, but a local log entry is kept.
- GPS unavailable + no PK typed → the alert is still sent, `GH` empty, `accuracy_m = null`. The dispatcher sees "position inconnue — rappeler".
- SMS longer than 160 chars must be impossible: the encoder asserts it and drops optional fields first.
- Duplicate taps on "send" are covered by the client idempotency key.

### 4.8 Implementation checklist
- [ ] Console route shell, wire log fed by real `sms_log` / device events / ingest events, `ÉMULATION` badge component
- [ ] Panel 1 chip live view: heartbeat telemetry, Web Serial log stream, g-force chart
- [ ] Expo: Android dev build pipeline (`expo prebuild`), `svx-sms` native module (send + delivery + receive ack + Cell-ID)
- [ ] Expo: impact detector service + countdown screen + alarm
- [ ] Expo: 3-Tap witness flow (FR/AR), GPS fallback to Cell-ID then PK text
- [ ] Expo: online extras (photo, voice) with post-alert upload
- [ ] Expo: outbox + netinfo + automatic SMS fallback + raw SMS preview + ack handling
- [ ] Expo: profile registration + consent; cell survey screen
- [ ] Panel 3: SMS-menu conversation view; USSD emulator wired to the real callback
- [ ] Trace replay (host build of the firmware detector), badged `ÉMULATION`
- [ ] Rehearsal checklist: SIM credit, signal at venue, modem COM port, outdoor GPS fix recorded

---

## SECTION 5 — View A: Protection Civile Dispatcher Command Dashboard
`apps/web/src/routes/dispatcher`

### 5.1 Objective & Scope
Let one dispatcher understand any incident in **under 30 seconds** and approve or adjust the response in **one click**. Raw evidence and automated suggestions sit side by side, so trust can be checked at a glance.

### 5.2 Layout (desktop, 1440 px; usable down to 1024 px)
```
┌──────────── Header: live counters (open / RED / awaiting decision), clock, connection status ────────────┐
│ Incident queue (left 25%)  │  Map (center 45%)                       │ Incident detail (right 30%)      │
│ sorted: RED → awaiting →   │ react-leaflet + OSM tiles               │ tabs: Évaluation | Signaux bruts │
│ newest; severity chip,     │ incident pins (color = severity),       │       | Profil | Journal          │
│ alert count, age, source   │ uncertainty circles for USSD,           │                                  │
│ icons, confidence bar      │ units + hospitals layers, zone overlay  │ [Approve / Modify & Dispatch]    │
└────────────────────────────┴─────────────────────────────────────────┴──────────────────────────────────┘
```

### 5.3 Incident detail panel
- **AI/automated evaluation card:**
  - severity chip + `reasons[]` list (e.g., "G = 11.2 (capteur)", "Feu signalé par 2 témoins", "Patient sous anticoagulant")
  - recommended units + authority + Vittel level 2 prefill
  - AI-derived facts in a visually distinct "Suggestion IA" style
- **Raw signals tab:** each alert with source, channel, time, position accuracy, raw SMS string, photo thumbnails, audio player + transcript. Controls: **Split** (move selected alerts to a new incident), **Merge** (drag an incident onto another), **Mark false alarm**.
- **Medical profile risk banner** (only when a profile is linked): red banner for HIGH (e.g., "ANTICOAGULANT — risque hémorragique"), blood type, allergies, plus a "SI peu fiable (bêtabloquant)" note. Access is logged.
- **Authority card:** "Gendarmerie Nationale — 1055 (hors périmètre urbain)" with the reason, and a "Notifier" button. It sends a **real SMS summary** through `apps/gateway` to the configured authority number (a teammate's phone in the demo) and is logged.
- **Dispatch form:** pre-filled from the recommendation. Units are picked from available units sorted by distance. Severity can be edited. **If anything differs from the recommendation, a modification reason is required** (dropdown + free text). Then **Approve & Dispatch**.
- **Journal tab:** audit trail from `incident_events`.

### 5.4 Data flow
`dispatcher` subscription → queue + map update in place. A new RED incident triggers a sound and a tab title flash. Approve → `dispatch.approve` → server emits `dispatch.assigned` to `unit:{id}` → the unit pin changes state.

### 5.5 Edge cases
- New alerts merge **after** the dispatch decision → a "Nouvelles informations" badge + escalation suggestion appears, with no automatic change.
- Two dispatchers open the same incident → optimistic lock (`version` column), and the second approver gets "déjà traité par X".
- No available medicalised unit → the recommendation shows "aucune disponible — plus proche: X à 18 min" and suggests a VSAV now plus a medicalised unit later.
- Unknown position → the incident is pinned in a "Sans position" queue section with a call-back prompt (MSISDN available to authorised roles only).
- Map tiles need internet. The dispatcher center is assumed connected, so this is acceptable. Mention offline tile caching as future work.

### 5.6 Implementation checklist
- [ ] Route + 3-pane layout + header counters
- [ ] Subscription hook with snapshot + resume
- [ ] Incident queue (sorting, filters)
- [ ] Map: incidents, uncertainty circles, units, hospitals, zones
- [ ] Evaluation card with reasons + AI-labelled facts
- [ ] Raw signals tab with media + Split / Merge / False alarm
- [ ] Profile risk banner (access-logged)
- [ ] Authority card + notify (simulated)
- [ ] Dispatch form with required modification reason + optimistic lock
- [ ] Escalation suggestion UI, audio alert
- [ ] Journal tab

---

## SECTION 6 — View B: Protection Civile Ambulance Medic Tablet
`apps/web/src/routes/ambulance/$unitId` (responsive web/PWA for a landscape tablet)

> **Decision:** build it in `apps/web`, not `apps/native`. It reuses the shadcn components and map, a tablet browser is enough, and it avoids a second native app. The trade-off is that offline support for this view is limited to a cached form plus queued submission.

### 6.1 Objective & Scope
- Show the assigned mission (destination, incident summary, profile risk).
- Run the on-scene **Bilan secouriste**: Vittel + vitals + live Shock Index.
- Produce a live specialty-matched hospital recommendation.
- Let the medic confirm or override the destination, which sends the AT-MIST.

### 6.2 Screens
1. **Mission** (from `dispatch.assigned`): incident address/PK, map route line, dispatcher notes, profile risk banner, "Arrivé sur les lieux" button (→ status `on_scene`).
2. **Victim selector:** add victim N, link a profile (prefilled when known), or "inconnu" with estimated age and sex.
3. **Bilan secouriste** (one scrollable page, large touch targets, works with gloves):
   - **Vittel** grouped into 5 collapsible levels:
     - Level 2 items arrive pre-filled from sensors with a "capteur — à confirmer" chip. The medic taps to confirm or reject.
     - Level 5 items are pre-filled from the profile.
     - Level 1 is **auto-computed from the vitals** (read-only, live).
     - Banner: "TRAUMATISÉ GRAVE (Vittel)" as soon as any item is positive.
   - **Constantes vitales:** steppers plus sliders (number entry is always available, since sliders alone are error-prone):
     - GCS 3–15, with an optional E/V/M sub-picker that computes the total
     - FC 20–250
     - PAS 0–300 / PAD
     - SpO2 50–100
     - optional FR
   - **Shock Index badge:** live value + colour + caveats ("bêtabloquant", "pédiatrique").
   - **Suspected injuries:** body-region toggles (crâne, rachis, thorax, abdomen, bassin, membres, brûlure), pre-suggested from Vittel.
   - **Treatments given:** collier cervical, O2, garrot, voie veineuse, remplissage, immobilisation, PLS…
4. **Orientation:**
   - Ranked hospital list + map. Each card shows ETA, ✓ matched capabilities, ✗ missing ones, divert status, and a "transfert secondaire probable" warning.
   - **Confirm recommended** or **Choose another**, which requires an override reason (dropdown: évolution patient / trafic / demande patient / capacité connue / autre).
   - Confirming → `assessments.confirmDestination` → AT-MIST built and pushed to the hospital.
5. **En route:** handover status (pending / accepted / **diverted**).
   - On divert: alert sound + next best hospital pre-selected, and the medic confirms in one tap.
   - "Mettre à jour constantes" re-sends updated vitals to the hospital board.

### 6.3 Data flow
Vitals change → client-side shared `shockIndex`, `evaluateVittel`, `deriveNeeds` and `matchHospitals` run instantly with no network round-trip. Hospital statuses are cached from the last sync. On submit, the server recomputes with the same shared code and stores both the recommendation and the decision.

### 6.4 Edge cases
- Vitals outside physiological ranges → soft warning with re-confirmation, never blocked (a real reading can be extreme).
- Missing vitals → SI shows "—" and the matcher uses the remaining data, with confidence lowered.
- Cardiac arrest (no pulse / PAS 0) → shortcut: "ACR" flag, nearest ICU-capable facility, everything else bypassed.
- Multi-victim → each victim gets its own destination. Two patients to the same hospital → the hospital sees 2 cards.
- Connectivity lost on scene → the form is kept locally (localStorage). Submit is queued, and an AT-MIST SMS fallback is offered (text rendering from S2-K).
- Hospital goes to `divert` *while* the medic is choosing → the list updates live and a selected-but-now-diverting hospital asks for re-confirmation.

### 6.5 Implementation checklist
- [ ] Unit login/route, mission screen, status transitions
- [ ] Victim selector + profile linking
- [ ] Vittel 5-level form with source chips + auto level 1/5
- [ ] Vitals inputs (stepper + slider + numeric), GCS E/V/M helper
- [ ] Live Shock Index badge with caveats
- [ ] Injuries + treatments pickers
- [ ] Orientation list + map + override reason
- [ ] Handover status, divert flow with next-best preselection, vitals refresh
- [ ] Local persistence + queued submit + SMS fallback button
- [ ] Tablet touch-target audit (≥ 48 px), landscape layout

---

## SECTION 7 — View C: Hospital ER Pre-Arrival Board
`apps/web/src/routes/hospital/$hospitalId`

### 7.1 Objective & Scope
A wall-screen or desk board for the ER (*Urgences / Pavillon des urgences*). It shows incoming patients as **AT-MIST cards** with an ETA countdown and preparation actions. It has **one-click Accept / Divert**, and specialty availability toggles that feed the matcher.

### 7.2 Layout
```
┌─ Header: hospital name · specialty status toggles (Neurochir ✓ | Scanner ✓ | Brûlés ✗ DIVERT | Réa ✓ …) ─┐
│ Incoming (sorted by ETA)                                                                                 │
│ ┌─ AT-MIST card ──────────────────────────────────────────────────┐  ┌─ next card … ─┐                    │
│ │ RED · ETA 07:42 ⟳  · VSAV-12 · Choc hémorragique suspecté (SI 1.2) │                                    │
│ │ A  58 ans · M · O− · ANTICOAGULANT (apixaban) · allergie: pénicilline                                  │
│ │ T  Accident 14:03 · Prise en charge 14:19                                                             │
│ │ M  Tonneaux · Incarcération · Décès même véhicule  (Vittel ✓)                                          │
│ │ I  Crâne · Thorax · Bassin                                                                            │
│ │ S  GCS 11 · FC 118 · PA 92/60 · SpO2 91% · [SI 1.28 CRITIQUE]                                          │
│ │ T  Collier cervical · O2 · VVP · remplissage 500 ml                                                    │
│ │ ▶ PRÉPARER : Scanner · Culots O− · Bloc trauma · Neurochirurgien d'astreinte                          │
│ │ [ ACCEPTER ]        [ DÉRIVER — spécialité saturée ▾ ]                                                 │
│ └───────────────────────────────────────────────────────────────────┘                                    │
│ History (accepted / arrived today)                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Behaviour
- `hospital:{id}` subscription. A new card triggers a sound and stays in a highlighted "unacknowledged" state until it is acknowledged.
- **Accept** → `hospitals.respondHandover(accepted)` → the ambulance sees "Accepté par CHU X".
- **Divert** → the user must pick the saturated specialty. This (a) sets that specialty to `divert` in `hospitals_matrix.status`, (b) notifies the ambulance with the next best match computed by the server, and (c) moves the card to "Dérivé".
- Specialty toggles in the header can be flipped at any time, with immediate effect on every matcher.
- **Stale status protection:** a `divert` older than 6 h shows a "confirmer statut ?" prompt, so a forgotten toggle does not silently exclude a hospital forever.
- Vitals refreshes from the medic update the card in place, with a "mis à jour il y a 30 s" stamp and an arrow showing the trend (↑↓).
- ETA countdown is local. It turns amber at 5 min and red at "arrivée imminente". Card arrival → "Arrivé" button → closes the handover.
- Print-friendly / large-font mode for a wall screen. FR primary, AR secondary labels.

### 7.4 Edge cases
- The board is offline or nobody acknowledges within 60 s → server SMS fallback to the hospital phone (S3). The card shows "envoyé aussi par SMS".
- The ambulance re-orients away from this hospital → the card is cancelled with the reason shown.
- Two ambulances, same hospital, same specialty → no automatic capacity math. The board shows the count of incoming patients needing that specialty, so staff can decide whether to divert.
- Divert clicked by mistake → 10 s undo toast before propagation.

### 7.5 Implementation checklist
- [ ] Route + hospital selection/login
- [ ] Specialty status toggle bar (+ stale-status prompt)
- [ ] AT-MIST card component (shared with the dispatcher journal for consistency)
- [ ] Subscription + sound + unacknowledged state
- [ ] Accept / Divert with specialty picker + undo window
- [ ] Next-best computation on divert (server) + ambulance notification
- [ ] Live vitals refresh with trend arrows, ETA countdown, arrival close
- [ ] Wall-screen mode, FR/AR labels
- [ ] SMS fallback indicator

---

## SECTION 8 — B2B Vehicle Crash Chip (Hardware + Firmware)
`hardware/` · `firmware/` (PlatformIO, C++, ESP32)

### 8.1 Objective & Scope
Build a **working prototype** of the in-vehicle unit that:
- detects a crash from real sensors (impact, rollover, fire/smoke)
- computes peak g and Delta-V
- gets a position (GPS, or Cell-ID as fallback)
- sends the alert over 4G when it has data, or as a **real SVX SMS** when it does not
- retries until the server acknowledges

Conceptually it is an Algerian, offline-tolerant cousin of the EU **eCall** system. Our SVX payload plays the role of eCall's "Minimum Set of Data" (EN 15722), which is a strong framing for the technical jury.
Out of scope: automotive certification, a custom PCB (a breadboard/perfboard prototype + KiCad schematic is enough), CAN-bus/airbag integration (listed as future work).

### 8.2 Block diagram
```
 12 V vehicle ─► buck 12→5 V ─► charger/power-path ─► 18650 Li-ion (backup: crash may cut 12 V)
                                        │
                                        ▼ 3.3 V
 ┌──────────── ESP32 (dual core) ─────────────┐
 │ core 0: sensor sampling (1.6 kHz, ISR/FIFO) │◄─ SPI ─ ADXL375  (±200 g impact)
 │ core 1: state machine, GNSS, modem, logging │◄─ I²C ─ MPU-6050 (gyro + low-g → roll/pitch)
 └──────────────────────────────────────────────┘◄─ UART ─ GNSS (u-blox NEO-M8N/NEO-6M + backup cell)
        │ UART (AT)                │ GPIO/ADC          ◄─ ADC ─ MQ-2 smoke · GPIO ─ IR flame sensor
        ▼                          ▼
   SIM7600 (LTE Cat-1, 2G fallback, SMS)    Buzzer + RGB LED + "ANNULER" cabin button
```

### 8.3 Bill of materials (prototype; check local availability and prices in Algeria)
| Part | Choice | Why / fallback |
|---|---|---|
| MCU | ESP32-WROOM-32 DevKit | Dual core, cheap, PlatformIO support. Fallback: ESP32-S3 |
| Impact accelerometer | **ADXL375** (±200 g, up to 3200 Hz ODR) | Real crash pulses reach 20–60 g. **Fallback:** MPU-6050 alone saturates at ±16 g, so we then estimate severity from *saturation duration* and say so |
| Orientation | MPU-6050 (gyro + accel) | Rollover via complementary filter |
| GNSS | u-blox NEO-M8N (or NEO-6M) + active antenna | Backup battery keeps hot start (< 2 s fix after a power cut) |
| Cellular | **SIM7600** (LTE Cat-1, falls back to 2G, SMS + data) | Fallback: SIM800L (2G only). It needs a 2 A peak supply plus a large capacitor and is known to brown out; **check that 2G is still active on our operator** |
| Fire/smoke | MQ-2 (smoke) + IR flame sensor | MQ-2 needs a ~60 s warm-up, which the firmware handles |
| Power | LM2596/MP1584 buck, TP4056-class charger with protection, 18650 cell | Must keep working after the 12 V line is cut |
| HMI | Active buzzer, RGB LED, push button | 10 s cancel window, as in the phone app |
| Enclosure | 3D-printed or ABS project box, **rigidly screwed** to the rig | An accelerometer in a loose box measures rattle, not the crash |

### 8.4 Firmware architecture (`firmware/`, PlatformIO + Arduino framework or ESP-IDF)
```
firmware/
├─ src/main.cpp
├─ src/sensors/{adxl375,mpu6050,gnss,smoke}.cpp
├─ src/detect/crash_detector.cpp     # pure C++, no hardware calls → unit-testable on host
├─ src/detect/orientation.cpp        # complementary filter roll/pitch
├─ src/comm/modem.cpp                # AT driver: data (HTTPS) + SMS + Cell-ID (AT+CPSI?)
├─ src/comm/svx_encoder.cpp          # SVX v1 encoder + CRC-8 + HMAC (mbedTLS, built into ESP32)
├─ src/comm/outbox.cpp               # persisted in NVS/LittleFS, retry until ack
├─ src/state_machine.cpp
├─ test/test_svx_vectors.cpp         # consumes packages/shared/test-vectors/svx.json
├─ test/test_crash_detector.cpp      # replays recorded traces
└─ platformio.ini                    # envs: esp32 (device), native (host tests)
```
**State machine:**
`BOOT → IDLE (parked) ↔ ARMED (speed > 15 km/h or ignition) → IMPACT → CONFIRM (10 s buzzer, cancel button) → SEND → AWAIT_ACK (retry 30 s, 1 min, 2 min…; switch channel each attempt) → DONE`
- Rollover and fire can enter `IMPACT` without a g-spike (fire in a parked car still alerts).
- If the occupant cannot respond, the alert goes out when the window expires. Cancelling is logged, and the event record is still uploaded later.

**Detection algorithm (deterministic, documented, testable):**
- Ring buffer of 5 s before and 2 s after the event at 1.6 kHz ("black box"), uploaded when online for later analysis.
- Impact = |a| > 6 g for ≥ 3 ms (filters potholes and door slams), with ARMED state required.
- **Delta-V** = ∫ a·dt over the crash pulse (high-pass filtered, gravity removed, axis aligned at install), cross-checked with GPS speed before and after.
- Rollover = |roll| or |pitch| > 90° held for ≥ 2 s (complementary filter, gyro + accel).
- Fire = MQ-2 above a calibrated baseline + flame-sensor trigger, debounced over 3 s.
- Thresholds are constants in one header and match the shared kinematics thresholds in S2-D (a single table, documented in both places).

**Comms:**
- online → `POST /devices/:id/events` (HTTPS, HMAC header)
- fail → SVX SMS via `AT+CMGS` (with `H` + `CI` fields)
- server reply `SVXACK` received by SMS or HTTP → `DONE`

The outbox survives reboot, because power may come back unreliably.

**Provisioning:** the device secret and server number are flashed per device over USB. The secret is stored in NVS. On the server, its hash goes into `vehicles.device_secret_hash`.

### 8.5 Demo rig (so the crash on stage is physical and real)
- **Crash cart:** the chip is screwed onto an RC car or a wheeled board, rolled down a ramp into a padded wall. This produces a genuine high-g pulse. The serial log on the console shows the real samples.
- **Rollover:** physically flip the rig. The real gyro detects it.
- **Fire:** an IR flame sensor triggered by a lighter held at a safe distance. **Clear it with the organisers first**; the alternative is a smoke-free heat source.
- "ARMED" normally needs vehicle speed. On stage, a **physical "demo arm" switch** wired to a GPIO forces ARMED. It is logged and reported in the payload (`emulated` flag), so nothing is hidden.

### 8.6 IoT Showcase — web demonstration & trigger panel (`apps/web/src/routes/iot`)
A breadboard with wires is convincing to the embedded judges but unreadable from the back of the room. The **IoT Showcase** is a polished, full-screen web page that **explains the chip visually while it runs**, and lets us **trigger every chip scenario from the page**. It complements the S4.3 console panel: the console is the engineer's view (raw bytes, wire log), the Showcase is the jury's view (story, visuals, one big screen).

**Two modes, always visible in the header:**
| Mode | Source of truth | What the trigger buttons do | Badge |
|---|---|---|---|
| **LIVE — chip connecté** (default on stage) | The real chip, over Web Serial (USB) or its 4G heartbeat/telemetry stream | Send a signed command to the **real firmware**, which runs its real state machine, real modem and real SMS. The page only displays what the chip reports back. | `LIVE` (green) |
| **Jumeau numérique** (backup when the chip is absent/broken) | The firmware detector compiled for the host (same C++ as the S4.3 trace replay, served by the server) | Run the same scenario through the host build; alerts are stored with `emulated: true` | `ÉMULATION` (amber, permanent) |

The page never animates something the chip did not report. Every visual state is driven by an event from the chip (or the host twin), so the honesty rule from S4.1 and Appendix A still holds.

**Layout (16:9, designed for a projector, dark theme, large type, FR primary / AR secondary):**
```
┌─ Header: SVX Chip · device_id · LIVE/ÉMULATION badge · 4G ▮▮▮▯ · GPS 9 sat · Batterie 87% · 12 V ✓ ─────────┐
│ ┌─ Jumeau 3D du véhicule (45%) ─────────────┐  ┌─ Schéma du boîtier (animated block diagram, 55%) ───────┐ │
│ │ low-poly car, roll/pitch follow the real  │  │ ADXL375 · MPU-6050 · GNSS · MQ-2/flamme · ESP32 ·        │ │
│ │ gyro; impact flash at the measured point; │  │ SIM7600 · batterie. Each block lights up when it is      │ │
│ │ smoke/flame overlay when fire is detected │  │ active; "packets" travel along the wires (SPI, I²C,      │ │
│ └───────────────────────────────────────────┘  │ UART, AT) in real time                                   │ │
│ ┌─ Courbe g (last 5 s, 6 g threshold line) ─┐  └──────────────────────────────────────────────────────────┘ │
│ │ peak g · durée · Delta-V · roulis/tangage │  ┌─ Machine d'états ───────────────────────────────────────┐ │
│ └───────────────────────────────────────────┘  │ IDLE → ARMED → IMPACT → CONFIRM (10 s ring) → SEND → ACK │ │
│                                                 └──────────────────────────────────────────────────────────┘ │
│ ┌─ Parcours de l'alerte (timeline) ─────────────────────────────────────────────────────────────────────────┐ │
│ │ 🚗 Puce ──(4G ou SMS)──► 📡 Antenne ──► 🖥 Modem SVX ──► ⚙ Serveur ──► 🧑‍🚒 Dispatcher   with real timestamps │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ [ Scénarios ▸ Choc frontal | Tonneau | Incendie à l'arrêt | Zone blanche (sans data) | Nid-de-poule ]  [ Reset ] │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Visual components:**
- **3D vehicle twin:** `@react-three/fiber` + a low-poly car model (CC0). Roll/pitch come from the real complementary filter output, so physically flipping the rig flips the car on screen. On impact: shake + red flash on the impact side (from the dominant axis of the pulse).
- **Animated block diagram:** the S8.2 diagram redrawn as SVG. Components glow when they produce data; the modem block shows the AT command currently running (`AT+CMGS…`); the battery block turns orange when the 12 V line is cut.
- **g-force chart:** live line chart with the 6 g / 3 ms threshold drawn, the detected pulse shaded, and peak g + Delta-V shown as big numbers.
- **State machine strip:** the S8.4 states as pills; the active state is highlighted, CONFIRM shows the 10 s countdown ring and a "bouton ANNULER pressé" event if the occupant cancels.
- **Alert journey timeline:** each hop lights up when its real event arrives (chip `SEND` → `sms_log` received → ingest → `incident.created`). It shows the measured latency per hop and the total "crash → dispatcher" time (the KPI from Appendix A).
- **Packet anatomy card:** the real SVX SMS that was sent, split into colour-coded fields (`SVX1`, geohash, g, Delta-V, flags, `CI`, `H`, CRC) with a one-line explanation per field and the 160-char counter. It shows eCall MSD (EN 15722) as the comparison.
- **Presentation mode:** `F` = full screen, `1`–`5` = scenarios, `R` = reset, `Space` = cancel during CONFIRM. Hidden cursor, no scrollbars, readable at 1280×720.

**Scenario triggers (each maps to one firmware command):**
| Button | Command to the real chip | What really happens | Flag in payload |
|---|---|---|---|
| Choc frontal 40 km/h | `inject_trace frontal_40` | A **recorded real crash trace** from the rig is fed into the real detector on the chip; the rest (state machine, GNSS, modem, real SMS) is live | `trace_injected: true` |
| Tonneau | `inject_trace rollover` | Same, with a recorded rollover gyro trace. Physically flipping the rig does the same without any flag | `trace_injected: true` |
| Incendie à l'arrêt | `inject_trace fire_parked` | Smoke + flame trace injected; shows that fire alerts even when parked | `trace_injected: true` |
| Zone blanche (sans data) | `force_channel sms` | Firmware disables its data context (`AT+CGACT=0`) so the alert really leaves as SMS | — (channel is real) |
| Nid-de-poule (faux positif) | `inject_trace pothole` | 9 g for 1 ms → the detector rejects it; the page shows "filtré : durée < 3 ms" | `trace_injected: true` |
| Armer / désarmer | `arm on/off` | Same effect as the physical demo-arm switch (S8.5) | `emulated` (as S8.5) |
| Test buzzer / LED | `selftest` | Hardware self-test, nothing sent | — |

The physical crash on the rig stays the headline moment. The buttons are for repeatability, scenarios that cannot be done on stage (real fire), and as backup. Every injected trace is labelled `TRACE ENREGISTRÉE` on the page and in the dispatcher's raw-signals tab.

**Command path (page → chip):**
- **USB (primary on stage):** Web Serial (Chrome). Line protocol: page → chip `SVXCMD <seq> <cmd> <args> <hmac>`; chip → page `@T{json}` telemetry at 20 Hz (g, roll, pitch, state, GPS, signal, battery, active block) plus `@E{json}` events (state change, AT command, SMS sent, ack). The existing human-readable log lines are kept for the S4.3 console.
- **Over the air (no cable):** `POST /devices/:deviceId/commands` (role `admin`) queues a command. The chip picks it up in the response to its heartbeat, verifies the HMAC with its device secret, executes it and reports back through `/devices/:deviceId/events`. Live telemetry over 4G is reduced to 2 Hz to save data.
- Commands are **signed, numbered (replay-protected) and audited** in `incident_events` / a `device_commands` log. The firmware refuses `inject_trace` unless the demo-arm switch is on, so the feature cannot fire on a real vehicle.
- Page → server events reuse the `dispatcher` subscription (S3.6), so the timeline shows exactly what the dispatcher receives.

**Tech:** route `apps/web/src/routes/iot/` · `@react-three/fiber` + `@react-three/drei` (3D) · SVG + Framer Motion (block diagram, wires, timeline) · the same chart library as S4.3 · shadcn/ui for controls · `useChipStream()` hook that merges Web Serial and SSE sources behind one typed interface (`ChipTelemetry`, `ChipEvent` zod schemas in `packages/shared`).

**Edge cases:**
- USB unplugged mid-demo → the page switches to the 4G stream automatically and shows "liaison USB perdue — télémétrie via 4G".
- No chip at all → "Jumeau numérique" mode can be enabled only by an explicit toggle, never automatically, and the `ÉMULATION` badge covers the header.
- Command not acknowledged by the chip within 3 s → the button shows "pas de réponse de la puce" and nothing is animated.
- Browser without Web Serial (Firefox/Safari) → OTA path only, with a notice.

### 8.7 Edge cases
- Power cut at impact → keeps running on the battery. Brown-out reset mid-send → the outbox resumes after reboot.
- No GPS fix (tunnel, indoor, cold start) → last known fix with its age, plus `CI` (Cell-ID). The server resolves it and shows the uncertainty.
- No network at all → keep retrying SMS with backoff and buzz locally. The alert is stored and sent when coverage returns, carrying the original event time `T`.
- Accelerometer saturation → flagged in the payload, and the peak g is reported as "≥ value".
- Repeated impacts (secondary collision) → a single event extended with an `impacts` count. No alert storm.
- Mounting orientation unknown → calibration routine at install (gravity vector, stored in NVS).

### 8.8 Implementation checklist
- [ ] Order parts (ADXL375 + SIM7600 have the longest lead time). Buy a SIM with SMS credit and data
- [ ] KiCad schematic + wiring diagram in `hardware/`, BOM with sources
- [ ] Bring-up: each sensor alone (serial print), modem `AT` / SMS send / `AT+CPSI?`
- [ ] Power path: 12 V bench supply → buck → battery; test the 12 V cut-off
- [ ] `crash_detector` + `orientation` as pure C++ with host unit tests on recorded traces
- [ ] SVX encoder + CRC + HMAC, passing the shared `svx.json` vectors (native env)
- [ ] Modem driver: HTTPS POST, SMS send, ack receive, Cell-ID
- [ ] State machine + outbox (NVS/LittleFS) + cancel button/buzzer
- [ ] Heartbeat + live serial log format for the console's Web Serial view
- [ ] Enclosure + rigid mount + crash cart / ramp rig
- [ ] Firmware: `@T`/`@E` structured serial stream, `SVXCMD` parser with HMAC + sequence check, `inject_trace` (gated by demo-arm switch), `force_channel`, `selftest`
- [ ] Record the real rig traces used by the scenario buttons (frontal, rollover, fire, pothole) and store them in `firmware/traces/`
- [ ] Server: `POST /devices/:deviceId/commands` + delivery in heartbeat response + command audit log
- [ ] IoT Showcase page: `useChipStream()` (Web Serial + SSE), 3D vehicle twin, animated block diagram, g chart, state machine strip, alert journey timeline, packet anatomy card
- [ ] Scenario buttons + keyboard shortcuts + presentation mode; LIVE / ÉMULATION mode switch with host twin backup
- [ ] Projector rehearsal: readability at 1280×720, contrast, FR/AR labels, timing of the full scenario
- [ ] End-to-end test: rig impact → real SMS → modem gateway → dispatcher incident in < 30 s

---

## Appendix A — Cross-cutting concerns
| Topic | Plan |
|---|---|
| **Privacy (Loi 18-07)** | Explicit consent at profile registration. No medical data in SMS. MSISDN hashed. Profile access by role, logged. Data minimisation in AT-MIST (no name unless needed). |
| **i18n** | FR primary, AR labels on the B2C app and the hospital board. Darja is handled through STT input, not as a UI language. RTL check on the Arabic screens. |
| **Observability** | Every human decision and every automated recommendation is in `incident_events`. An "Explain" drawer in each view shows why. |
| **Testing** | Unit (shared, ≥90% on the clinical core), integration (ingest pipeline), one Playwright end-to-end demo script (scenario 1 from S4). |
| **Demo resilience** | `resetDemo`, spare SIM + spare modem, check signal at the venue beforehand, AI kill switch, pre-recorded Darja audio, local Postgres (no venue Wi-Fi dependency except map tiles; bring a hotspot). Any backup that is not real (trace replay, USSD emulator) is visibly badged `ÉMULATION`. |
| **Code-review readiness (technical jury)** | No hard-coded "success" paths: every UI state comes from real data in the DB or event stream. Emulated data is flagged in the DB (`emulated` column) and in the UI. The README has an "Ce qui est réel / ce qui est émulé" table. Cross-language protocol test vectors. CI runs typecheck + vitest + PlatformIO native tests. |
| **KPIs to show the jury** | Time from crash to dispatch decision (target < 90 s in the demo), alerts merged per incident, % of RED patients routed to a hospital that has the needed specialty on the first attempt, number of avoided secondary transfers (simulated). |

## Appendix B — Open questions for the team
1. Which hospital in Algiers is the actual burn-care reference, and which EPH/EPSP should be in the seed? Who verifies this?
2. Hardware: what do we already own (ESP32, MPU-6050, GPS module, SIM800L/SIM7600)? Where do we buy the ADXL375 / SIM7600 in time?
3. SIM cards: 2–3 SIMs with SMS credit (chip, gateway modem, test phone). Which operator has the best signal at the venue, and is 2G still active on it (needed if we use the SIM800L)?
4. Who on the team has an Android phone for the development build (needed for automatic SMS)?
5. AI provider keys and budget for STT + vision during the event?
6. Should the Gold Sponsor's possible alternative problem change the scope? (The note on page 1 of the brief allows it.)

---
**Next step:** tell me which section to expand first. Recommended order: **S1 → S2 → S3**, then S4–S7 in parallel.
