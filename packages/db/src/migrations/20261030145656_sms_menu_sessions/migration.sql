CREATE TABLE "sms_menu_sessions" (
	"msisdn_hash" text PRIMARY KEY,
	"lang" text NOT NULL,
	"step" text NOT NULL,
	"answers" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
