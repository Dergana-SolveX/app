import {
  AmbulanceIcon,
  HospitalIcon,
  RadioTowerIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";

import { ENV } from "../env";

export type QuickLogin = {
  label: string;
  hint: string;
  email: string;
  icon: LucideIcon;
};

/** One-click demo logins (see docs/DEMO-ACCOUNTS.md). All share the seeded demo password. */
export const QUICK_LOGINS: QuickLogin[] = [
  { label: "Dispatcher", hint: "Protection Civile", email: "dispatcher@svx.demo", icon: RadioTowerIcon },
  { label: "Secouriste 1", hint: "Unité PC-ALG-01", email: "medic1@svx.demo", icon: AmbulanceIcon },
  { label: "Secouriste 2", hint: "Unité PC-HRH-01", email: "medic2@svx.demo", icon: AmbulanceIcon },
  { label: "Urgences hôpital", hint: "CHU Mustapha", email: "hospital-mustapha@svx.demo", icon: HospitalIcon },
  { label: "Administrateur", hint: "Console et IoT", email: "admin@svx.demo", icon: ShieldCheckIcon },
];

export const DEMO_PASSWORD = ENV.VITE_DEMO_PASSWORD;
