CREATE TABLE "ussd_sessions" (
	"session_id" text PRIMARY KEY,
	"msisdn_hash" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"cell_id" text,
	"emulated" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"incident_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cell_towers_lat_lng_idx" ON "cell_towers" ("lat","lng");--> statement-breakpoint
ALTER TABLE "ussd_sessions" ADD CONSTRAINT "ussd_sessions_incident_id_master_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "master_incidents"("id");