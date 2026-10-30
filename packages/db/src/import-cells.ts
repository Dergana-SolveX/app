// Usage: bun run db:import-cells <path to 603.csv or 603.csv.gz>
// Download the file for MCC 603 (Algeria) from https://opencellid.org (a free account gives you a token).
import "varlock/auto-load";

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

import { createDb } from "./index";
import { importOpenCellId } from "./opencellid";

const path = process.argv[2];
if (!path) {
  console.error("Usage: bun run db:import-cells <path to 603.csv or 603.csv.gz>");
  process.exit(1);
}

const db = createDb({ DATABASE_URL: process.env.DATABASE_URL ?? "" });
const file = createReadStream(path);
const lines = createInterface({ input: path.endsWith(".gz") ? file.pipe(createGunzip()) : file, crlfDelay: Infinity });

const { imported, skipped } = await importOpenCellId(db, lines);
console.log(`Imported ${imported} towers (MCC 603), skipped ${skipped} lines.`);
process.exit(0);
