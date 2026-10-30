# Seed data sources

All seed data is **demonstration data** and must be labelled "données de démonstration" in the UI.

## Hospitals (`hospitals.ts`)
Names are real Algiers facilities. **Coordinates and capabilities were written from memory and are
approximate. They have not been verified.** Every row has `verified = false`.

Before the demo, a team member must, for each hospital:
1. Check coordinates against a map and update `lat` / `lng`.
2. Check each `cap_*` flag with the hospital or an official source.
3. Record the source below and set `verified: true`.

Open questions:
- Which facility Algiers actually routes burns to. The `Centre des brûlés` row is a placeholder.
- Which EPH / EPSP facilities should be in the seed.

| Hospital | Source | Checked by | Date |
|---|---|---|---|
| _(none yet)_ | | | |

## Ambulance units, zones, profiles, vehicles
Fictional. Unit bases and zone polygons are rough approximations, not official boundaries.
Profile phone numbers (`+213000000xxx`) are placeholders. The demo device secrets in
`profiles.ts` are throwaway values.
