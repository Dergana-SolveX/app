CREATE TYPE "alert_channel" AS ENUM('internet', 'sms', 'ussd');--> statement-breakpoint
CREATE TYPE "alert_source" AS ENUM('iot', 'app_auto', 'app_witness', 'ussd');--> statement-breakpoint
CREATE TYPE "authority" AS ENUM('surete_nationale', 'gendarmerie_nationale');--> statement-breakpoint
CREATE TYPE "handover_status" AS ENUM('pending', 'accepted', 'diverted');--> statement-breakpoint
CREATE TYPE "hospital_tier" AS ENUM('chu', 'ehs', 'eph', 'epsp_polyclinic');--> statement-breakpoint
CREATE TYPE "incident_status" AS ENUM('open', 'dispatched', 'on_scene', 'transporting', 'handed_over', 'closed', 'false_alarm');--> statement-breakpoint
CREATE TYPE "severity" AS ENUM('red', 'yellow', 'green', 'unknown');--> statement-breakpoint
CREATE TYPE "unit_type" AS ENUM('vsav_standard', 'ambulance_medicalisee', 'desincarceration');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"short_code" char(8) NOT NULL UNIQUE,
	"full_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"sex" text NOT NULL,
	"blood_type" text,
	"chronic_conditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergies" text[] DEFAULT '{}'::text[] NOT NULL,
	"medications" jsonb DEFAULT '[]' NOT NULL,
	"pregnancy_status" text DEFAULT 'none' NOT NULL,
	"emergency_contact" text,
	"consent_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"device_id" text NOT NULL UNIQUE,
	"device_secret_hash" text NOT NULL,
	"sim_msisdn" text,
	"firmware_version" text,
	"last_heartbeat_at" timestamp with time zone,
	"battery_mv" integer,
	"last_telemetry" jsonb,
	"plate" text,
	"make_model" text,
	"fleet_name" text,
	"owner_profile_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cell_towers" (
	"mcc" integer,
	"mnc" integer,
	"lac" integer,
	"cid" integer,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"range_m" integer NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "cell_towers_pkey" PRIMARY KEY("mcc","mnc","lac","cid")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"kind" text DEFAULT 'urban_perimeter' NOT NULL,
	"polygon" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"device_id" text NOT NULL,
	"seq" integer NOT NULL,
	"cmd" text NOT NULL,
	"args" jsonb DEFAULT '[]' NOT NULL,
	"hmac" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"issued_by" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	"result" jsonb,
	CONSTRAINT "device_commands_device_seq_unique" UNIQUE("device_id","seq")
);
--> statement-breakpoint
CREATE TABLE "sms_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"direction" text NOT NULL,
	"msisdn_hash" text NOT NULL,
	"body" text NOT NULL,
	"modem_ref" text,
	"status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ambulance_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"call_sign" text NOT NULL UNIQUE,
	"type" "unit_type" NOT NULL,
	"base_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"available" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospitals_matrix" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"tier" "hospital_tier" NOT NULL,
	"commune" text NOT NULL,
	"wilaya" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"phone" text,
	"cap_neurosurgery" boolean DEFAULT false NOT NULL,
	"cap_ct_scanner" boolean DEFAULT false NOT NULL,
	"cap_burn_unit" boolean DEFAULT false NOT NULL,
	"cap_icu" boolean DEFAULT false NOT NULL,
	"cap_trauma_surgery" boolean DEFAULT false NOT NULL,
	"cap_pediatric" boolean DEFAULT false NOT NULL,
	"cap_obstetrics" boolean DEFAULT false NOT NULL,
	"cap_blood_bank" boolean DEFAULT false NOT NULL,
	"cap_stabilization_only" boolean DEFAULT false NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"status_updated_at" timestamp with time zone,
	"status_updated_by" text,
	"verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incident_id" uuid NOT NULL,
	"recommended" jsonb NOT NULL,
	"decided" jsonb NOT NULL,
	"modified" boolean DEFAULT false NOT NULL,
	"modification_reason" text,
	"dispatcher_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unit_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"authority_notified" boolean DEFAULT false NOT NULL,
	"authority_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incident_id" uuid,
	"actor_role" text NOT NULL,
	"actor_id" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"lat" double precision,
	"lng" double precision,
	"geohash8" text,
	"location_uncertainty_m" integer,
	"first_alert_at" timestamp with time zone NOT NULL,
	"last_alert_at" timestamp with time zone NOT NULL,
	"confidence_score" numeric(4,3) DEFAULT '0' NOT NULL,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"status" "incident_status" DEFAULT 'open'::"incident_status" NOT NULL,
	"rec_severity" "severity" DEFAULT 'unknown'::"severity" NOT NULL,
	"rec_units" jsonb,
	"rec_authority" "authority",
	"ai_summary" jsonb,
	"vittel_prefill" jsonb,
	"linked_profile_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"estimated_victims" integer,
	"pk_marker" text,
	"commune" text,
	"road_ref" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incident_id" uuid,
	"source" "alert_source" NOT NULL,
	"channel" "alert_channel" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_at" timestamp with time zone,
	"lat" double precision,
	"lng" double precision,
	"geohash" text,
	"accuracy_m" integer,
	"g_force" double precision,
	"delta_v_kmh" double precision,
	"rollover_deg" double precision,
	"fire" boolean,
	"victims" integer,
	"conscious" integer,
	"trapped" boolean,
	"bleeding" boolean,
	"profile_id" uuid,
	"vehicle_id" uuid,
	"raw_payload" text,
	"media" jsonb,
	"transcript" text,
	"transcript_lang" text,
	"parse_errors" jsonb,
	"sender_msisdn_hash" text,
	"dedupe_key" text UNIQUE,
	"emulated" boolean DEFAULT false NOT NULL,
	"trace_injected" boolean DEFAULT false NOT NULL,
	"impacts" integer,
	"saturated" boolean,
	"authenticated" boolean
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"assessment_id" uuid NOT NULL,
	"hospital_id" uuid NOT NULL,
	"atmist" jsonb NOT NULL,
	"status" "handover_status" DEFAULT 'pending'::"handover_status" NOT NULL,
	"responded_at" timestamp with time zone,
	"responded_by" text,
	"divert_specialty" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medic_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incident_id" uuid NOT NULL,
	"dispatch_id" uuid,
	"unit_id" uuid,
	"victim_index" integer DEFAULT 1 NOT NULL,
	"profile_id" uuid,
	"est_age" integer,
	"sex" text,
	"vittel" jsonb,
	"gcs" integer,
	"hr" integer,
	"sbp" integer,
	"dbp" integer,
	"spo2" integer,
	"rr" integer,
	"shock_index" numeric(4,2),
	"suspected_injuries" text[] DEFAULT '{}'::text[] NOT NULL,
	"treatments" text[] DEFAULT '{}'::text[] NOT NULL,
	"rec_hospital_id" uuid,
	"rec_ranking" jsonb,
	"chosen_hospital_id" uuid,
	"override_reason" text,
	"eta_minutes" double precision,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"role" text NOT NULL,
	"unit_id" uuid,
	"hospital_id" uuid,
	"auth_user_id" text
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "medical_profiles_short_code_idx" ON "medical_profiles" ("short_code");--> statement-breakpoint
CREATE INDEX "vehicles_device_id_idx" ON "vehicles" ("device_id");--> statement-breakpoint
CREATE INDEX "sms_log_at_idx" ON "sms_log" ("at");--> statement-breakpoint
CREATE INDEX "incident_events_incident_at_idx" ON "incident_events" ("incident_id","at");--> statement-breakpoint
CREATE INDEX "master_incidents_status_last_alert_idx" ON "master_incidents" ("status","last_alert_at");--> statement-breakpoint
CREATE INDEX "master_incidents_lat_lng_idx" ON "master_incidents" ("lat","lng");--> statement-breakpoint
CREATE INDEX "raw_alerts_received_at_idx" ON "raw_alerts" ("received_at");--> statement-breakpoint
CREATE INDEX "raw_alerts_incident_id_idx" ON "raw_alerts" ("incident_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_profile_id_medical_profiles_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "medical_profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_incident_id_master_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "master_incidents"("id");--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_master_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "master_incidents"("id");--> statement-breakpoint
ALTER TABLE "raw_alerts" ADD CONSTRAINT "raw_alerts_incident_id_master_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "master_incidents"("id");--> statement-breakpoint
ALTER TABLE "raw_alerts" ADD CONSTRAINT "raw_alerts_profile_id_medical_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "medical_profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "raw_alerts" ADD CONSTRAINT "raw_alerts_vehicle_id_vehicles_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_assessment_id_medic_assessments_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "medic_assessments"("id");--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_hospital_id_hospitals_matrix_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals_matrix"("id");--> statement-breakpoint
ALTER TABLE "medic_assessments" ADD CONSTRAINT "medic_assessments_incident_id_master_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "master_incidents"("id");--> statement-breakpoint
ALTER TABLE "medic_assessments" ADD CONSTRAINT "medic_assessments_dispatch_id_dispatches_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id");--> statement-breakpoint
ALTER TABLE "medic_assessments" ADD CONSTRAINT "medic_assessments_unit_id_ambulance_units_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ambulance_units"("id");--> statement-breakpoint
ALTER TABLE "medic_assessments" ADD CONSTRAINT "medic_assessments_profile_id_medical_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "medical_profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "medic_assessments" ADD CONSTRAINT "medic_assessments_rec_hospital_id_hospitals_matrix_id_fkey" FOREIGN KEY ("rec_hospital_id") REFERENCES "hospitals_matrix"("id");--> statement-breakpoint
ALTER TABLE "medic_assessments" ADD CONSTRAINT "medic_assessments_chosen_hospital_id_hospitals_matrix_id_fkey" FOREIGN KEY ("chosen_hospital_id") REFERENCES "hospitals_matrix"("id");--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_unit_id_ambulance_units_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ambulance_units"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_hospital_id_hospitals_matrix_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals_matrix"("id") ON DELETE SET NULL;