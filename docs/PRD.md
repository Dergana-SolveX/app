# SVX Rescue — Product Requirements Document

> SolveX 3.0 · Problématique 1 · Accidents de la route : améliorer la réponse aux urgences
> Source plan: [`PLAN.md`](../PLAN.md). Where this PRD and PLAN.md disagree, **this PRD wins**.
> Status: approved for decomposition into tasks. Requirement IDs are stable; reference them in issues.

---

## 1. Summary

SVX Rescue shortens the time between a road crash in Algeria and the arrival of the right patient at the right hospital. It covers the four steps of the brief:

1. **Detection:** a vehicle chip (simulated), a smartphone (real sensors), or a witness (smartphone or feature phone).
2. **Alert:** over the internet, or with no data connection over SMS / USSD.
3. **Evaluation:** the Protection Civile dispatcher sees one merged incident with a deterministic triage proposal and approves the dispatch.
4. **Orientation:** the medic logs Vittel criteria and vitals. The system computes the Shock Index, routes on the road network, recommends the nearest hospital that has the needed specialty, and sends an AT-MIST handover the hospital can Accept or Divert.

A human makes the decision at every gate.

## 2. Goals and non-goals

### 2.1 Goals
- **G1:** Show the four steps in one continuous demo of under 5 minutes.
- **G2:** One real-world crash appears as exactly one incident, however many alerts arrive.
- **G3:** Every automated recommendation is deterministic, explainable (`reasons[]`) and overridable.
- **G4:** Every alert input has a non-internet path (SMS or USSD), even if it is emulated on stage.
- **G5:** A technical jury reading the code finds no hard-coded success path. What is simulated is labelled as simulated.

### 2.2 Non-goals
- Physical crash chip hardware or C++ firmware. The chip is conceptual and simulated (§9).
- Integration with hospital IT / EMR systems.
- Live traffic routing, Google Maps or OSRM (future work, §15).
- Cloud production deployment, auth hardening, multi-instance scaling.
- Darja as a UI language (it is handled only as speech input).
- A regional supervisor overview page.

## 3. Principles (apply to every requirement)

| ID | Principle | Consequence |
|---|---|---|
| NFR-P1 | **Human-in-the-loop** | No dispatch, destination change or hospital acceptance is written without a human action. Automated outputs are stored as `rec_*` / `recommended` fields, human choices as `decided` / `chosen_*` fields. Both are written to `incident_events`. |
| NFR-P2 | **Offline-first** | Each input has an SMS or USSD path. The medic tablet computes Shock Index, Vittel, hospital ranking and route locally with no network. |
| NFR-P3 | **No hospital IT dependency** | Hospitals are a curated static matrix plus one Accept/Divert toggle per specialty. |
| NFR-P4 | **Deterministic before AI** | Severity comes from deterministic rules. AI only adds extracted facts, shown as "Suggestion IA — à vérifier". AI may raise a severity *suggestion*, never lower it. |
| NFR-P5 | **Honesty rule** | Everything downstream of the device is real (API, ingest, clustering, triage, DB, realtime, UI). Anything simulated (chip, SMS network, USSD operator, feature phone, synthetic traces, demo history) carries a permanent `ÉMULATION` badge in the UI and `emulated = true` in the DB. |
| NFR-P6 | **Never drop a distress signal** | Corrupted, unauthenticated or partial alerts are ingested with `parse_errors` / lower confidence, never discarded. |

## 4. Users and roles

| Role | Surface | Main jobs |
|---|---|---|
| Victim / witness | Expo Android app (Galaxy A71 dev build); feature phone (emulated) | Auto-detect crash, cancel false alarm, 3-tap witness report, register medical profile |
| Dispatcher (Protection Civile) | `apps/web` → `/dispatcher` | Understand an incident in < 30 s, approve or modify dispatch, notify authority, split/merge incidents, view statistics |
| Medic (ambulance) | `apps/web` → `/ambulance/$unitId` (tablet, landscape) | Mission, bilan secouriste, hospital choice, handover follow-up |
| Hospital ER | `apps/web` → `/hospital/$hospitalId` | Incoming AT-MIST, Accept/Divert, specialty status toggles, statistics |
| Admin / presenter | `/console`, `/iot` | Observe all traffic, drive emulators and the simulated chip, reset demo |

## 5. Architecture

### 5.1 Stack (already scaffolded)
Bun monorepo (Better-T-Stack) · Turborepo · Hono + tRPC v11 · Drizzle ORM · **Neon Postgres** · React + Vite + TanStack Router + Tailwind + shadcn/ui · Expo (Uniwind) · Better Auth · varlock env management.

### 5.2 Layout
```
apps/
  server/      Hono: tRPC (/trpc), webhooks, device REST, SSE, media
  web/         routes: console/, iot/, dispatcher/, ambulance/$unitId, hospital/$hospitalId, login
  native/      Expo victim/witness app + modules/svx-sms (Kotlin)
  gateway/     SmsTransport adapters: modem | android | emulator
packages/
  shared/      pure TS core (S2): protocol, geo, routing, clustering, triage, matcher, AT-MIST, chip simulator, i18n
  db/          Drizzle schema, migrations, seed
  api/         tRPC routers + services
  auth/        Better Auth config
  ui/          shared shadcn components
hardware/      concept docs only (block diagram, BOM, cost, how-it-would-be-built)
docs/          this PRD
```
`firmware/` is removed (no physical chip).

### 5.3 Environment variables (`apps/server/.env`, typed by `.env.schema`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_POOLED` | Neon direct (migrations) / pooled (runtime) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN` | Auth |
| `AI_ENABLED`, `MISTRAL_API_KEY`, `MISTRAL_STT_MODEL`, `MISTRAL_VISION_MODEL` | AI pipeline (kill switch) |
| `GATEWAY_SHARED_SECRET` | `apps/gateway` → `POST /internal/sms` |
| `MASTER_DEVICE_SECRET` | Root for per-device HMAC keys (FR-S2-06) |
| `SMS_TRANSPORT` | `emulator` (stage default) \| `android` \| `modem` |

### 5.4 Frontend design requirement
- **NFR-UI1:** Every frontend task (web routes, Expo screens, shared UI components) **must use the UI/UX Pro Max skills installed in `.claude/skills/`** (`ui-ux-pro-max`, plus `ui-styling` / `design-system` where relevant) for layout, palette, typography, accessibility and component choices before implementation.
- **NFR-UI2:** One design system across all views (tokens in `packages/ui`). Dark theme for `/iot` (projector), light/dark for the rest.
- **NFR-UI3:** FR primary, AR secondary. RTL is checked on every Arabic screen.

---

## 6. S1 — Database & monorepo  *(done, except where noted)*

| ID | Requirement | Status |
|---|---|---|
| FR-S1-01 | 15 app tables + 8 enums in `packages/db/src/schema/` (see PLAN.md §1.3, plus `device_commands`, `app_users`) | Done |
| FR-S1-02 | Relations, indexes, exported `$infer*` types | Done |
| FR-S1-03 | Migrations via `bun run db:generate` / `db:migrate`, applied to Neon | Done |
| FR-S1-04 | Idempotent `bun run db:seed`; `bun run db:reset` truncates app tables only (never auth, never `cell_towers`) | Done |
| FR-S1-05 | `vehicles.device_secret_hash` = SHA-256 of the **derived** device key (FR-S2-06), used only as a provisioning check | Done with this PRD |
| FR-S1-06 | Seed one Better Auth email/password account per `app_users` row with a seeded demo password; `app_users.auth_user_id` linked | To do |
| FR-S1-07 | Seed "historique démo": ~40 past incidents over the last 30 days with alerts, dispatches, assessments, handovers, all `emulated = true`; restored by `db:reset` | To do |
| FR-S1-08 | Hospital coordinates and capabilities verified by a team member; sources in `packages/db/src/seed/SOURCES.md`; `verified = true` | To do (manual) |
| FR-S1-09 | Add `emulated bool` to `master_incidents`, `dispatches`, `medic_assessments`, `handovers` (for demo history and statistics filtering) | To do |

---

## 7. S2 — Shared core & clinical engine (`packages/shared`)

Pure TypeScript with no I/O. **zod is the only runtime dependency.** It must run unchanged in Bun, the browser and Expo (offline). Own implementations for geohash, CRC-8 and haversine; Web Crypto for HMAC/HKDF.

### 7.1 Thresholds
- **FR-S2-01:** One `thresholds.ts` table with separate entries, documented and exported into `test-vectors/`:

| Key | Rule |
|---|---|
| `phone_trigger` | peak ≥ 4 g **and** GPS speed ≥ 25 km/h in previous 10 s **and** < 5 km/h afterwards |
| `chip_trigger` | \|a\| > 6 g for ≥ 3 ms, ARMED state required |
| `vittel_l2_high_energy` | g ≥ 4 **and** ΔV ≥ 30 km/h |
| `rollover` | \|roll\| or \|pitch\| > 90° held ≥ 2 s |
| `cluster_time_min` / `cluster_distance_m` | 10 min sliding window / 200 m + uncertainty (cap 3000 m) |

### 7.2 SVX v1 SMS protocol (frozen)
- **FR-S2-02:** Encode/decode `SVX1#L:…#GH:…#T:…#G:…#R:…#FIRE:…#V:…#C:…#TR:…#B:…#UID:…#DV:…#CI:…#H:…#CK:…` exactly as PLAN.md §2.3-A.
  - `T` = epoch minutes in base36. `GH` = geohash precision 8.
  - `CK` = **CRC-8/SMBUS** (poly 0x07, init 0x00), 2 uppercase hex chars, over everything before `#CK`.
  - `H` = first 6 base32 chars of HMAC-SHA256(device_key, message before `#H`). Chip only. 30 bits is accepted for v1.
  - GSM-7 charset only, ≤ 160 chars (target ≤ 140). The encoder drops optional fields before exceeding 160 and asserts the limit.
- **FR-S2-03:** The tolerant decoder ignores unknown keys, maps missing optional keys to `null`, and on bad CRC returns the alert with `parse_errors` set (NFR-P6).
- **FR-S2-04:** `test-vectors/svx.json` (inputs → exact strings, plus corrupted cases) is the protocol reference. Vitest consumes it. A future real firmware must pass it.
- **FR-S2-05:** Tests: round-trip property tests, max-length, fuzzed corruption.

### 7.3 Device keys
- **FR-S2-06:** `deriveDeviceKey(masterSecret, deviceId)` = HKDF-SHA256(ikm = master secret, salt = `"svx-device-v1"`, info = deviceId, 32 bytes). `deviceKeyCheck(key)` = SHA-256 hex, stored in `vehicles.device_secret_hash`. The server derives keys on demand. Raw device keys are never stored.

### 7.4 Geo
- **FR-S2-07:** Geohash encode/decode/neighbors, haversine (m), bounding box, point-in-polygon (ray casting). Tested against known Algiers coordinates.

### 7.5 Clustering
- **FR-S2-08:** `shouldMerge(alert, incident)`: |event_at − last_alert_at| ≤ 10 min (sliding) and haversine ≤ 200 m + min(alert.accuracy, incident.uncertainty, 3000). A match that relies on coarse accuracy (USSD / Cell-ID) is marked **tentative**. With several matches, the nearest wins.
- **FR-S2-09:** `confidence()` = 1 − Π(1 − wᵢ). Weights: IoT 0.6, app-auto 0.45, app-witness 0.4, USSD 0.3. A bonus applies for independent sources. Unauthenticated chip SMS and bad CRC are downgraded.
- **FR-S2-10:** Event time is used when trusted (±24 h skew check), otherwise received time.

### 7.6 Kinematics → Vittel level 2 prefill
- **FR-S2-11:** high-energy (per `vittel_l2_high_energy`) → "évaluation globale"; rollover → "tonneaux"; fire → level 3 "brûlure / inhalation" *suspected*; trapped → "victime incarcérée". Every item carries `source: iot | app | medic`.
- **FR-S2-12:** Phone false-positive filter per `phone_trigger`. A dropped phone fails the speed test.

### 7.7 Vittel evaluator (frozen list)
- **FR-S2-13:** `evaluateVittel(input) → { severe, positives[] }`. One positive item means severe.
  1. Physiological: GCS < 13, SBP < 90, SpO2 < 90 %.
  2. Kinetic: ejection, death in same vehicle, fall > 6 m, thrown/crushed, global assessment (deformation, speed, no seatbelt/helmet), blast.
  3. Anatomical: penetrating trauma head/neck/thorax/abdomen/arm/thigh, flail chest, severe burn / smoke inhalation, pelvic fracture, suspected spinal injury, amputation proximal to wrist/ankle, acute limb ischaemia.
  4. Resuscitation: assisted ventilation, fluids > 1000 ml, catecholamines, anti-shock garment.
  5. Terrain: age > 65, cardiac/coronary insufficiency, respiratory insufficiency, pregnancy T2–T3, coagulation disorder (**auto from anticoagulant in profile**).
- The PRD notes that levels 1–2 are a deliberate abridgement of the official 2002 grid. The team owns the clinical decisions; no specialist sign-off is required.

### 7.8 Shock Index (frozen)
- **FR-S2-14:** `shockIndex(hr, sbp, ctx) → { value, flag, caveats[] } | null`.
  - `> 0.9` elevated, `≥ 1.3` critical.
  - SBP = 0 / unmeasurable → critical, "PAS imprenable".
  - Missing HR or SBP → `null` (never 0).
  - Caveats: beta-blocker ("peut sous-estimer le choc"), age < 12 ("seuils adultes non applicables"), pregnancy, **age > 65 on antihypertensive** ("peut sous-estimer").

### 7.9 Severity & unit recommendation
- **FR-S2-15:** Initial triage, before a medic is on scene:
  - **RED:** (kinetic positive and conscious = 0) · fire · trapped · IoT g ≥ 8 · profile-risk HIGH with g ≥ 4 · victims ≥ 3.
  - **YELLOW:** kinetic positive alone · bleeding · high-risk profile.
  - **GREEN:** low g, all conscious, no flags.
  - **UNKNOWN:** insufficient data, never shown as green.
- **FR-S2-16:** Units:
  - RED → medicalised ambulance (+ désincarcération if trapped/rollover).
  - Victims ≥ 3 → **+1 VSAV**. It forces a medicalised unit only if another RED rule fired.
  - YELLOW → VSAV. GREEN → VSAV, lower priority.
- **FR-S2-17:** Every recommendation returns human-readable `reasons[]` (FR, with AR labels).

### 7.10 Profile risk & authority
- **FR-S2-18:** `profileRisk(profile) → { level, flags[], prepTags[] }`:
  - anticoagulant → HIGH, "risque hémorragique interne", tag "bilan de coagulation / antidote"
  - insulin → "glycémie capillaire"
  - allergies → listed verbatim
  - blood type → "préparer culots {type} / O−"
  - beta-blocker → "SI peu fiable"
- **FR-S2-19:** `routeAuthority(lat, lng, zones, roadRef?)`: inside an urban perimeter → Sûreté Nationale (17 / 1548). Outside, or on a national road / autoroute outside a perimeter → Gendarmerie Nationale (1055). Configurable rule.

### 7.11 Road routing (own algorithm, offline)
- **FR-S2-20:** A build script extracts an **Algiers road graph from OpenStreetMap** (motorway, trunk, primary, secondary, tertiary + links). Each edge has length and a speed by road class. Output: a compact JSON asset (target < 1 MB gzipped), versioned in the repo with its OSM date and licence (ODbL attribution in the UI).
- **FR-S2-21:** `route(graph, from, to)` = **A\*** (haversine heuristic). It returns duration, distance, polyline and a simple step list (road names). Snap-to-nearest-node for origin and destination.
- **FR-S2-22:** `travelTimesToMany(graph, from, targets[])` = **one multi-target Dijkstra** run that returns road ETAs to all hospitals in a single pass.
- **FR-S2-23:** Fallback when a point is off-graph: haversine × 1.4 ÷ (50 km/h inside a zone polygon, 80 km/h outside). The result is flagged `eta_source: 'straight_line'`.
- **FR-S2-24:** Optional fixed rush-hour multiplier per road class (configurable, off by default). No live traffic, and the UI says so.
- **FR-S2-25:** Tests: known routes in Algiers produce plausible ETAs. A* and Dijkstra agree on the same pairs.

### 7.12 Hospital matcher
- **FR-S2-26:** `deriveNeeds(assessment, profile)`:
  - GCS ≤ 13 or head trauma → neurosurgery + CT
  - burn/smoke → burn unit
  - SI > 0.9 or SBP < 90 → trauma surgery + blood bank + ICU
  - spinal → neurosurgery + CT
  - pregnancy → obstetrics
  - age < 15 → pediatric preferred
  - polytrauma → trauma surgery + ICU + CT
- **FR-S2-27:** `matchHospitals(needs, hospitals, origin, graph)`. It ranks by a transparent **weighted score**: `score = eta_min + W_missing × missing_count + W_divert × diverting_needed_count` (weights in `thresholds.ts`). Each result carries `matched[]`, `missing[]`, `eta_min`, `eta_source`, `score`, `score_breakdown`.
- **FR-S2-28:** Hospitals with all needs met and no relevant divert rank first. If none qualify, return the best partial match flagged `secondary_transfer_risk` plus the nearest stabilisation facility. Polyclinics are recommended only for GREEN, or as "stabiliser d'abord" when the best ETA > 45 min **and** the patient is in shock.

### 7.13 AT-MIST
- **FR-S2-29:** `buildAtMist(incident, assessment, profile, dispatch)` returns a structured object plus an SMS rendering of ≤ 3 segments. No name unless needed (data minimisation).

### 7.14 Chip simulator (see §9)
- **FR-S2-30:** `chip-sim/` contains the crash detector, complementary-filter orientation, fire debounce, state machine and synthetic trace generator. Pure TS, deterministic with a seed.

### 7.15 i18n
- **FR-S2-31:** `i18n/labels.ts`: French is the complete source of truth. Arabic covers victim app + hospital board labels. Missing AR falls back to FR, and a test lists untranslated keys. No Darja.

### 7.16 Quality
- **NFR-S2-1:** `vitest --coverage` ≥ 90 % on `triage/`, `sms/`, `cluster/`, `hospital/`, `routing/`.
- **NFR-S2-2:** zod schemas in `schemas/` are the single source for API input validation and form validation (`RawAlertInput`, `WitnessForm`, `IotTelemetry`, `MedicAssessment`, `AtMist`, `ChipTelemetry`, `ChipEvent`, `ChipCommand`).

---

## 8. S3 — Backend, AI and realtime (`apps/server`, `packages/api`, `apps/gateway`)

### 8.1 Auth
- **FR-S3-01:** Better Auth email/password. Role, unit and hospital come from `app_users` (linked by `auth_user_id`). `roleProcedure(role)` guards tRPC.
- **FR-S3-02:** The login page has one **quick-login button per demo role** (dispatcher, medic ×2, hospital, admin) using the seeded credentials.

### 8.2 Ingest pipeline
- **FR-S3-03:** All channels go through `normalize → INSERT raw_alerts → cluster → triage → UPDATE master_incidents → emit`.
- **FR-S3-04:** Idempotent: `dedupe_key` = sha1(raw_payload + sender_hash) for SMS, device_id + event_at for devices, client idempotency key for apps.
- **FR-S3-05:** Clustering in a transaction with `SELECT … FOR UPDATE` on candidates. 5 concurrent alerts produce 1 incident.
- **FR-S3-06:** Re-triage on every merge. A dispatcher decision is never overwritten. If new data raises severity after dispatch, emit `incident.escalation_suggested`.

### 8.3 Routers
- **FR-S3-07:** `alerts`, `incidents` (list, byId, split, merge, markFalseAlarm, onChange), `dispatch` (recommendation, approve with optimistic lock), `assessments` (upsert, recommendHospitals, confirmDestination), `hospitals` (list, setStatus, respondHandover, onHandover), `profiles` (register, byShortCode, role-gated and access-logged), `simulator` (chip commands, resetDemo), `stats` (§11).

### 8.4 SMS transport
- **FR-S3-08:** `apps/gateway` implements one `SmsTransport` interface with three adapters selected by `SMS_TRANSPORT`:
  - `emulator` (**stage default**): web "Réseau GSM (émulé)" panel. Inbound injection and outbound "Boîte d'envoi GSM".
  - `android`: an Android phone with a SIM relays SMS. Kotlin module shared with `svx-sms`. Tested with fixtures.
  - `modem`: USB GSM modem AT driver (`CMGF`, `CNMI`, `+CMTI`, `CMGR`, `CMGD`, `CMGS` + delivery reports, unread sweep, reconnect, command queue with timeouts). Tested against a recorded transcript. Lower priority.
- **FR-S3-09:** Inbound → `sms_log` → `POST /internal/sms` (shared secret) → ingest → ack `SVXACK#<ref>` via the same transport. Every SMS in/out is logged in `sms_log`, with `emulated` when it comes from the emulator.
- **FR-S3-10:** Real transports (`android`, `modem`) are fully implemented but **not used during the presentation**.

### 8.5 Device endpoints
- **FR-S3-11:** `POST /devices/:deviceId/events` and `/heartbeat`. The header carries `X-SVX-Signature` HMAC-SHA256(derived key, body) + a timestamp, and requests outside ±5 min are rejected.
- **FR-S3-12:** `POST /devices/:deviceId/commands` (admin) queues a signed, numbered command delivered in the heartbeat response, audited in `device_commands`.
- **FR-S3-13:** Chip SMS is authenticated by sender MSISDN = `vehicles.sim_msisdn` **and** the `H` field. A mismatch is ingested with `authenticated = false` and lower confidence.

### 8.6 Feature phones (emulated on stage)
- **FR-S3-14:** Interactive SMS menu (`ACCIDENT` / `حادث`): victims → conscious → danger → commune/PK, keyed by MSISDN. Commune geocoding table.
- **FR-S3-15:** USSD `POST /webhooks/ussd` follows the aggregator contract (`sessionId, serviceCode, phoneNumber, text`, `CON`/`END`). 120 s timeout with partial save. The emulator resolves Cell-ID from a real OpenCelliD tower near the chosen point.
- **FR-S3-16:** OpenCelliD import script for MCC 603 → `cell_towers`. Shared `resolveCell()`.

### 8.7 AI pipeline (Mistral)
- **FR-S3-17:** Provider interfaces `transcribe()` and `extractFacts()`. Implementations: **Voxtral** (STT, hints ar-DZ / fr / ar) and **Pixtral** (photos + transcript → strict JSON `{victims?, trapped?, fire?, bleeding?, vehicle_count?, vehicle_deformation?, hazards[], quotes[]}` validated with zod).
- **FR-S3-18:** Async and non-blocking. 8 s timeout. On failure the incident proceeds and the error is logged. `AI_ENABLED=false` kill switch. No AI on SMS/USSD alerts.
- **FR-S3-19:** Output is stored in `ai_summary` with `source: 'ai'`, labelled "Suggestion IA — à vérifier". It may raise, never lower, a severity suggestion.
- **FR-S3-20:** Media upload endpoint with size/type limits. Signed URLs, limited retention.

### 8.8 Realtime
- **FR-S3-21:** tRPC v11 subscriptions over SSE. Channels: `dispatcher`, `unit:{id}`, `hospital:{id}` with the events of PLAN.md §3.6. Snapshot + resume on reconnect. In-process typed event bus.
- **FR-S3-22:** If the hospital board has not acknowledged a handover within 60 s, the server sends the AT-MIST SMS rendering through the active `SmsTransport` (emulator outbox on stage).

### 8.9 Audit and reset
- **FR-S3-23:** Every human decision and every automated recommendation is written to `incident_events`.
- **FR-S3-24:** `simulator.resetDemo` calls `resetApp()` (restores seed + demo history).
- **NFR-S3-1:** Integration tests: 5 concurrent alerts → 1 incident; late SMS (`event_at ≪ received_at`); bad CRC; unauthenticated chip SMS; replayed device request rejected.

---

## 9. S8 — Crash chip (conceptual + simulated)

There is no physical hardware. The chip is designed on paper and simulated in software. Everything after the chip is real.

- **FR-S8-01:** `hardware/` holds concept documents: the block diagram (PLAN.md §8.2), BOM with indicative Algerian prices, power path, and a note on how the real device would be built and certified (eCall / EN 15722 framing).
- **FR-S8-02:** The chip simulator (FR-S2-30) implements the state machine `BOOT → IDLE ↔ ARMED → IMPACT → CONFIRM (10 s) → SEND → AWAIT_ACK (backoff, channel switch) → DONE`. Rollover and fire can enter IMPACT without a g-spike.
- **FR-S8-03:** The simulated chip behaves like a real device:
  - it has a seeded `vehicles` row and a derived key
  - it sends heartbeats and events to the real `/devices/:id/*` endpoints with HMAC
  - in "zone blanche" it sends a real SVX string through the SMS path (emulator transport)
  - it declares `emulated: true`, and the server stores it
- **FR-S8-04:** **Synthetic traces** come from a physics model, labelled `TRACE SYNTHÉTIQUE`:
  - `frontal_40` (≈ 25–35 g over 80–120 ms)
  - `rollover`
  - `fire_parked`
  - `pothole` (9 g for 1 ms → rejected, "filtré : durée < 3 ms")
- **FR-S8-05:** A **custom impact** control (peak g, pulse duration, roll angle, fire on/off) lets the jury try edge cases.
- **FR-S8-06:** Detection rules come from `thresholds.ts` (`chip_trigger`, `rollover`). Delta-V = ∫a·dt over the pulse. Saturation flag. Repeated impacts → one event with an `impacts` count.

### 9.1 IoT Showcase (`/iot`)
- **FR-S8-07:** A full-screen 16:9 dark page in mode **"Puce simulée"**, with a permanent `ÉMULATION` badge in the header. The LIVE / Web Serial / OTA hardware modes of PLAN.md are dropped.
- **FR-S8-08:** Components: 3D vehicle twin (`@react-three/fiber` + `drei`, CC0 low-poly car; roll/pitch from the simulator), animated block diagram (SVG + Framer Motion; blocks light up and the modem block shows the current AT command), live g chart with the 6 g / 3 ms threshold and shaded pulse, state machine strip with the CONFIRM countdown ring, alert journey timeline (chip → GSM → server → dispatcher with **measured** latencies from real server events), and a packet anatomy card (colour-coded SVX fields, 160-char counter, eCall MSD comparison).
- **FR-S8-09:** Scenario buttons: Choc frontal · Tonneau · Incendie à l'arrêt · Zone blanche (forces SMS channel) · Nid-de-poule · Armer/Désarmer · Reset. Keyboard: `F` fullscreen, `1`–`5` scenarios, `R` reset, `Space` cancel during CONFIRM.
- **FR-S8-10:** The timeline lights up only on real server events (`sms_log` received → ingest → `incident.created` on the `dispatcher` channel). Nothing is animated without a corresponding event.
- **NFR-S8-1:** Readable at 1280×720 on a projector. FR primary / AR secondary.

---

## 10. S4 — Field devices & demo console

### 10.1 Expo app (Galaxy A71, Android development build)
- **FR-S4-01:** **Victim mode**, auto-detect:
  - `expo-sensors` at ~50 Hz plus `expo-location` speed feed the shared `phone_trigger` filter.
  - Trigger → 15 s full-screen countdown with alarm, vibration and a giant "JE VAIS BIEN — ANNULER" button.
  - A hidden "simuler un choc" button exists for the demo.
- **FR-S4-02:** **Witness mode**, 3-Tap:
  - victims 1/2/3+ → conscious Oui/Non/Je ne sais pas → danger Feu/Coincé/Saignement/Aucun (multi)
  - FR/AR, huge buttons
  - GPS, else "Où êtes-vous ?" PK/commune after 20 s
- **FR-S4-03:** Online extras: up to 3 photos (~200 KB each) and a 30 s voice note, uploaded **after** the core alert.
- **FR-S4-04:** Offline outbox in AsyncStorage until ack. Retry on connectivity change. Two failed online attempts → SMS path.
- **FR-S4-05:** `svx-sms` Expo native module (Kotlin): `SmsManager.sendTextMessage` with sent/delivered intents, receive `SVXACK`, serving Cell-ID via `TelephonyManager`. Fully implemented, not used on stage. iOS falls back to the `expo-sms` composer.
- **FR-S4-06:** A **"Forcer canal SMS (démo)"** switch builds the real SVX string, shows it in the raw SMS preview (with character count), and posts it over the internet to the emulator `/internal/sms`, flagged `emulated: true`.
- **FR-S4-07:** Profile registration with Law 18-07 consent, showing the user their `short_code`.
- **FR-S4-08:** Cell survey screen logging (Cell-ID, GPS) pairs → `cell_towers` with `source = 'survey'`.
- **FR-S4-09:** Web phone-frame mirror of the app as a backup if the phone fails.

### 10.2 Demo console (`/console`)
- **FR-S4-10:** Split view: device panels on the left, **Wire log** on the right. The wire log reads real `sms_log`, device events and ingest events, with channel badges, byte size, delivery status and CRC/HMAC ✓/✗.
- **FR-S4-11:** **"Réseau GSM (émulé)"** panel: feature-phone mockup (SMS menu + USSD `*140#`), inbound SMS injection, and the **"Boîte d'envoi GSM"** outbox showing every outbound SMS (acks, AT-MIST fallback, authority notifications). Badged `ÉMULATION`.
- **FR-S4-12:** Chip panel: compact live view of the simulated chip (engineer view; `/iot` is the jury view).
- **FR-S4-13:** "Reset demo" restores the seed only and never fabricates traffic.

### 10.3 Demo scenarios
1. **Autoroute Est-Ouest, zone rurale (Gendarmerie):** simulated chip "Zone blanche" frontal crash (profile #1, anticoagulant) via SVX SMS; 40 s later, an A71 witness report with fire via "Forcer canal SMS"; then a feature-phone SMS menu report → **1 incident, 3 alerts, high confidence**.
2. **Bab Ezzouar, zone urbaine (Police):** online witness on the A71 with photo + Darja voice note → Mistral enrichment.
3. **False alarm:** phone shaken → countdown → cancelled → nothing reaches the dispatcher. Chip "Nid-de-poule" → filtered.

---

## 11. S5 — Dispatcher (`/dispatcher`)

As PLAN.md §5, with these requirements:
- **FR-S5-01:** 3-pane layout: queue (RED → awaiting → newest), map (react-leaflet + OSM tiles; incidents, uncertainty circles, units, hospitals, zones), and incident detail (tabs Évaluation | Signaux bruts | Profil | Journal | **Statistiques**). Header counters, connection status.
- **FR-S5-02:** Evaluation card shows severity + `reasons[]` + recommended units + authority + Vittel L2 prefill. AI facts are visually distinct.
- **FR-S5-03:** Raw signals: each alert with source, channel, time, accuracy, raw SMS, media, transcript, and `ÉMULATION` / `TRACE SYNTHÉTIQUE` badges. **Split / Merge / Mark false alarm**.
- **FR-S5-04:** Profile risk banner (access-logged): anticoagulant, blood type, allergies, "SI peu fiable".
- **FR-S5-05:** Authority card with reason + "Notifier". It sends an SMS summary through the active transport (outbox on stage) and logs it.
- **FR-S5-06:** Dispatch form prefilled from the recommendation. Any difference requires a modification reason. Optimistic lock: the second approver gets "déjà traité par X".
- **FR-S5-07:** New RED → sound + tab title flash. Post-dispatch merges → "Nouvelles informations" badge + escalation suggestion, with no automatic change.
- **FR-S5-08:** Edge cases from PLAN.md §5.5: no medicalised unit available, unknown position queue, map tiles needing internet.
- **FR-S5-09:** **Statistiques** (§13).

## 12. S6 — Ambulance medic tablet (`/ambulance/$unitId`)

As PLAN.md §6, with these requirements:
- **FR-S6-01:** Screens: Mission → Victim selector → Bilan secouriste → Orientation → En route.
- **FR-S6-02:** Bilan:
  - Vittel in 5 collapsible levels: L2 prefilled from sensors ("capteur — à confirmer"), L5 from profile, L1 auto-computed from vitals.
  - "TRAUMATISÉ GRAVE (Vittel)" banner.
  - Vitals steppers with numeric entry (GCS with E/V/M, FC, PAS/PAD, SpO2, FR).
  - Live Shock Index badge with caveats.
  - Injuries and treatments toggles. Large touch targets.
- **FR-S6-03:** Orientation:
  - ranked hospital cards: road ETA (`eta_source`), ✓ matched / ✗ missing, divert status, **score breakdown**, "transfert secondaire probable"
  - map with the **A\* route polyline and step list** to the chosen hospital, labelled "Itinéraire calculé localement (A*, OSM) — sans trafic en temps réel"
  - Confirm recommended, or Choose another with a mandatory override reason
- **FR-S6-04:** All of Shock Index, Vittel, needs, ranking and routing run client-side from `packages/shared` with no network. The road graph and last-known hospital statuses are cached. On submit, the server recomputes and stores both recommendation and decision.
- **FR-S6-05:** En route: handover status. On divert: alert + next best hospital preselected + one-tap confirm + new route. "Mettre à jour constantes" pushes vitals to the hospital board.
- **FR-S6-06:** Offline support is a cached form + queued submission (PWA).

## 13. S7 — Hospital ER board (`/hospital/$hospitalId`)

As PLAN.md §7, with these requirements:
- **FR-S7-01:** Incoming handover cards: AT-MIST, ETA countdown, SI badge, prep tags ("Préparer scanner + culots O−"), live vitals updates. **Accept / Divert** (divert requires a specialty).
- **FR-S7-02:** Specialty status toggles (accept/divert) feeding the matcher, with `status_updated_by/at`.
- **FR-S7-03:** Unacknowledged > 60 s → SMS fallback shown as "envoyé aussi par SMS".
- **FR-S7-04:** AR labels + RTL check.
- **FR-S7-05:** **Statistiques** tab (§14).

## 14. Statistics dashboards

Both tabs read **only** from `incident_events`, `dispatches`, `master_incidents`, `raw_alerts`, `medic_assessments`, `handovers`. A filter toggle includes or excludes `emulated` rows (default: include, with a "données de démonstration" notice). Date range filter. Charts follow NFR-UI1 (UI/UX Pro Max skills).

- **FR-ST-01, dispatcher `Statistiques`:**
  - crash → dispatch decision time (median, p90, trend)
  - alerts merged per incident
  - channel mix (internet / SMS / USSD)
  - severity split
  - recommendation override rate + top modification reasons
  - incidents by commune / authority
- **FR-ST-02, hospital `Statistiques`:**
  - arrivals per day by severity
  - Accept vs Divert rate
  - divert reasons by specialty
  - average lead time between AT-MIST and arrival
  - % of RED patients received with all needed capabilities on first attempt
- **FR-ST-03:** `stats` tRPC router with role-scoped queries. A hospital only sees its own data.

---

## 15. Out of scope / future work
- Physical chip (ESP32 + ADXL375 + SIM7600), C++ firmware passing `svx.json`, crash rig.
- Google Maps Routes / OSRM / live traffic. Offline map tile caching.
- Operator USSD short code and SMS-C agreement (Mobilis / Djezzy / Ooredoo, ARPCE).
- Longer HMAC truncation in SVX v2.
- Cloud deployment, Postgres `LISTEN/NOTIFY` / Redis event bus, auth hardening, EMR integration.
- Regional supervisor overview page.

## 16. Risks

| Risk | Mitigation |
|---|---|
| Voxtral accuracy on Darja | Test on 2–3 prepared recordings early. Always show raw audio + transcript + confidence to the dispatcher. |
| Hospital data is approximate | `verified = false` until checked. "données de démonstration" label. `SOURCES.md`. |
| OSM road graph quality / size in Algiers | Restrict to main road classes. Straight-line fallback flagged in UI. Size budget < 1 MB gzipped. |
| Venue internet (Neon, tiles, Mistral) | Phone hotspot. AI kill switch. Shared engine works offline on the tablet. |
| Clinical rules not reviewed by a specialist | Rules are deterministic, documented and visible (`reasons[]`). The human always decides. Stated openly in the pitch. |
| Two crashes within 200 m merge | Dispatcher Split action. Documented limitation. |

## 17. Acceptance — demo definition of done
1. Scenario 1 (§10.3) yields **one** incident with 3 alerts, RED, Gendarmerie, in under 30 s from the chip SEND to the dispatcher queue, and the IoT timeline shows the measured latencies.
2. The dispatcher approves in one click. The unit receives the mission live.
3. The medic's bilan shows Vittel severe, the SI badge with the anticoagulant caveat, a ranked list with score breakdown, and an A* route.
4. The hospital receives AT-MIST, diverts neurosurgery, and the tablet re-routes to the next best hospital in one tap.
5. Statistics tabs show non-empty charts from the demo history and include the live incident.
6. Every simulated element on screen shows `ÉMULATION` or `TRACE SYNTHÉTIQUE`. The README has the "Ce qui est réel / ce qui est émulé" table.
7. CI passes typecheck + vitest (coverage thresholds of NFR-S2-1) + the integration tests of NFR-S3-1.
