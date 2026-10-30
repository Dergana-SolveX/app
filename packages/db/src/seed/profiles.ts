import type { medicalProfiles, vehicles } from "../schema";

type Profile = typeof medicalProfiles.$inferInsert;
type Vehicle = typeof vehicles.$inferInsert;

const consentAt = new Date("2026-01-01T00:00:00Z");

// Fictional people, each built to trigger one demo story.
export const profiles: Profile[] = [
  {
    // 1. Anticoagulant: hemorrhage risk + Vittel level 5
    id: "00000000-0000-4000-8000-000000000301",
    shortCode: "K7Q2M9XA",
    fullName: "Profil démo 1 (anticoagulant)",
    birthDate: "1953-04-12",
    sex: "male",
    bloodType: "A+",
    chronicConditions: ["fibrillation auriculaire"],
    allergies: [],
    medications: [{ name: "Acénocoumarol (AVK)", class: "anticoagulant" }],
    emergencyContact: "+213000000001",
    consentAt,
  },
  {
    // 2. Type 1 diabetic: capillary glucose tag
    id: "00000000-0000-4000-8000-000000000302",
    shortCode: "R4T8WN3B",
    fullName: "Profil démo 2 (insuline)",
    birthDate: "1990-09-30",
    sex: "female",
    bloodType: "B+",
    chronicConditions: ["diabète de type 1"],
    allergies: ["pénicilline"],
    medications: [{ name: "Insuline", class: "insulin" }],
    emergencyContact: "+213000000002",
    consentAt,
  },
  {
    // 3. Beta-blocker: Shock Index may underestimate
    id: "00000000-0000-4000-8000-000000000303",
    shortCode: "H2V6C5ZD",
    fullName: "Profil démo 3 (bêtabloquant)",
    birthDate: "1968-01-22",
    sex: "male",
    bloodType: "O+",
    chronicConditions: ["hypertension artérielle"],
    allergies: [],
    medications: [{ name: "Bisoprolol", class: "beta_blocker" }],
    emergencyContact: "+213000000003",
    consentAt,
  },
  {
    // 4. Pregnant, 3rd trimester: Vittel level 5 + obstetrics required
    id: "00000000-0000-4000-8000-000000000304",
    shortCode: "M9P3F7YE",
    fullName: "Profil démo 4 (grossesse T3)",
    birthDate: "1996-06-05",
    sex: "female",
    bloodType: "AB+",
    chronicConditions: [],
    allergies: [],
    medications: [],
    pregnancyStatus: "t3",
    emergencyContact: "+213000000004",
    consentAt,
  },
  {
    // 5. Healthy baseline, O-
    id: "00000000-0000-4000-8000-000000000305",
    shortCode: "W5J8D2QF",
    fullName: "Profil démo 5 (référence)",
    birthDate: "2001-11-17",
    sex: "male",
    bloodType: "O-",
    chronicConditions: [],
    allergies: [],
    medications: [],
    emergencyContact: "+213000000005",
    consentAt,
  },
];

// Fleet vehicles linked to profiles 1, 3 and 5. `deviceSecretHash` is filled by the seed from
// the derived per-device key (HKDF over MASTER_DEVICE_SECRET).
export const vehicleRows: Omit<Vehicle, "deviceSecretHash">[] = [
  {
    id: "00000000-0000-4000-8000-000000000401",
    deviceId: "SVX-CHIP-001",
    simMsisdn: "+213550000001",
    plate: "00123-116-16",
    makeModel: "Renault Symbol",
    fleetName: "Flotte démo",
    ownerProfileId: "00000000-0000-4000-8000-000000000301",
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    deviceId: "SVX-CHIP-002",
    simMsisdn: "+213550000002",
    plate: "00456-117-16",
    makeModel: "Peugeot 301",
    fleetName: "Flotte démo",
    ownerProfileId: "00000000-0000-4000-8000-000000000303",
  },
  {
    id: "00000000-0000-4000-8000-000000000403",
    deviceId: "SVX-CHIP-003",
    simMsisdn: "+213550000003",
    plate: "00789-124-16",
    makeModel: "Hyundai Accent",
    fleetName: "Flotte démo",
    ownerProfileId: "00000000-0000-4000-8000-000000000305",
  },
];
