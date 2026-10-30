import type { ambulanceUnits } from "../schema";

type Row = typeof ambulanceUnits.$inferInsert;

// DEMO DATA: approximate base positions across Algiers.
export const units: Row[] = [
  { id: "00000000-0000-4000-8000-000000000201", callSign: "PC-ALG-01", type: "ambulance_medicalisee", baseName: "Alger-Centre", lat: 36.7733, lng: 3.0588 },
  { id: "00000000-0000-4000-8000-000000000202", callSign: "PC-BEO-01", type: "vsav_standard", baseName: "Bab El Oued", lat: 36.7895, lng: 3.0475 },
  { id: "00000000-0000-4000-8000-000000000203", callSign: "PC-HDY-01", type: "vsav_standard", baseName: "Hussein Dey", lat: 36.7405, lng: 3.0985 },
  { id: "00000000-0000-4000-8000-000000000204", callSign: "PC-HRH-01", type: "ambulance_medicalisee", baseName: "El Harrach", lat: 36.7155, lng: 3.1335 },
  { id: "00000000-0000-4000-8000-000000000205", callSign: "PC-BEZ-01", type: "vsav_standard", baseName: "Bab Ezzouar", lat: 36.7225, lng: 3.1865 },
  { id: "00000000-0000-4000-8000-000000000206", callSign: "PC-ROU-01", type: "desincarceration", baseName: "Rouiba", lat: 36.7385, lng: 3.2815 },
  { id: "00000000-0000-4000-8000-000000000207", callSign: "PC-DEB-01", type: "vsav_standard", baseName: "Dar El Beïda", lat: 36.7145, lng: 3.2125 },
  { id: "00000000-0000-4000-8000-000000000208", callSign: "PC-BMR-01", type: "desincarceration", baseName: "Bir Mourad Raïs", lat: 36.7355, lng: 3.0455 },
];
