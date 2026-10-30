import "varlock/auto-load";

import { createDb } from "../index";
import { resetApp, seed } from "./index";

const db = createDb({
  DATABASE_URL: process.env.DATABASE_URL ?? "",
});

const masterDeviceSecret = process.env.MASTER_DEVICE_SECRET;
if (!masterDeviceSecret) throw new Error("MASTER_DEVICE_SECRET is not set");

const demoPassword = process.env.DEMO_PASSWORD;
if (!demoPassword) throw new Error("DEMO_PASSWORD is not set");

const secrets = { masterDeviceSecret, demoPassword };
const reset = process.argv.includes("--reset");
await (reset ? resetApp(db, secrets) : seed(db, secrets));
console.log(reset ? "Database reset and seeded." : "Database seeded.");
process.exit(0);
