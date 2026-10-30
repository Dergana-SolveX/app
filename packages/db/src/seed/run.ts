import "varlock/auto-load";

import { createDb } from "../index";
import { resetApp, seed } from "./index";

const db = createDb({
  DATABASE_URL: process.env.DATABASE_URL ?? "",
});

const masterDeviceSecret = process.env.MASTER_DEVICE_SECRET;
if (!masterDeviceSecret) throw new Error("MASTER_DEVICE_SECRET is not set");

const reset = process.argv.includes("--reset");
await (reset ? resetApp(db, masterDeviceSecret) : seed(db, masterDeviceSecret));
console.log(reset ? "Database reset and seeded." : "Database seeded.");
process.exit(0);
