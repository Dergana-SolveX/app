import { ENV } from "../env";

export type QuickLogin = {
  label: string;
  hint: string;
  email: string;
};

/** One-click demo logins (see docs/DEMO-ACCOUNTS.md). All share the seeded demo password. */
export const QUICK_LOGINS: QuickLogin[] = [
  { label: "Dispatcher", hint: "Protection Civile", email: "dispatcher@svx.demo" },
  { label: "Secouriste 1", hint: "Unité PC-ALG-01", email: "medic1@svx.demo" },
  { label: "Secouriste 2", hint: "Unité PC-HRH-01", email: "medic2@svx.demo" },
  { label: "Hôpital", hint: "CHU Mustapha", email: "hospital-mustapha@svx.demo" },
  { label: "Admin", hint: "Console et IoT", email: "admin@svx.demo" },
];

export const DEMO_PASSWORD = ENV.VITE_DEMO_PASSWORD;
