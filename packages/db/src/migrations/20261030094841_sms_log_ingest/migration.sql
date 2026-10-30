ALTER TYPE "alert_source" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TABLE "sms_log" ADD COLUMN "emulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_log" ADD COLUMN "incident_id" uuid;--> statement-breakpoint
ALTER TABLE "sms_log" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "sms_log" ADD CONSTRAINT "sms_log_incident_id_master_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "master_incidents"("id");