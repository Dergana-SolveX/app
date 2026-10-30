import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

export const cellTowers = pgTable(
  "cell_towers",
  {
    mcc: integer("mcc").notNull(),
    mnc: integer("mnc").notNull(),
    lac: integer("lac").notNull(),
    cid: integer("cid").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    rangeM: integer("range_m").notNull(),
    source: text("source", { enum: ["opencellid", "survey"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.mcc, t.mnc, t.lac, t.cid] })],
);

export type GeoJsonPolygon = { type: "Polygon"; coordinates: number[][][] };

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["urban_perimeter"] })
    .notNull()
    .default("urban_perimeter"),
  polygon: jsonb("polygon").$type<GeoJsonPolygon>().notNull(),
});
