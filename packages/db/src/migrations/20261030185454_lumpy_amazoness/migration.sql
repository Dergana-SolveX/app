ALTER TABLE "dispatches" ADD COLUMN "emulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "master_incidents" ADD COLUMN "emulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "emulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "medic_assessments" ADD COLUMN "emulated" boolean DEFAULT false NOT NULL;