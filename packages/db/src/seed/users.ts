import type { appUsers } from "../schema";

type Row = typeof appUsers.$inferInsert;

const hospitalIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113];
const hospitalNames = [
  "Mustapha",
  "Bab El Oued",
  "Beni Messous",
  "Hussein Dey",
  "Zemirli",
  "Aït Idir",
  "Brûlés",
  "Rouiba",
  "Bologhine",
  "Aïn Taya",
  "Poly Bab Ezzouar",
  "Poly El Madania",
  "Poly Baraki",
];

export const userRows: Row[] = [
  { id: "00000000-0000-4000-8000-000000000601", name: "Dispatcher démo", role: "dispatcher" },
  { id: "00000000-0000-4000-8000-000000000602", name: "Admin démo", role: "admin" },
  {
    id: "00000000-0000-4000-8000-000000000603",
    name: "Secouriste démo 1",
    role: "medic",
    unitId: "00000000-0000-4000-8000-000000000201",
  },
  {
    id: "00000000-0000-4000-8000-000000000604",
    name: "Secouriste démo 2",
    role: "medic",
    unitId: "00000000-0000-4000-8000-000000000204",
  },
  ...hospitalIds.map((n, i): Row => ({
    id: `00000000-0000-4000-8000-000000000${700 + i}`,
    name: `Urgences ${hospitalNames[i]}`,
    role: "hospital",
    hospitalId: `00000000-0000-4000-8000-000000000${n}`,
  })),
];
