CREATE TYPE "public"."biometric_device_status" AS ENUM('ONLINE', 'OFFLINE', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."biometric_event_type" AS ENUM('CHECK_IN', 'CHECK_OUT', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."biometric_verification_method" AS ENUM('FACE', 'FINGERPRINT', 'CARD', 'PASSWORD', 'UNKNOWN');--> statement-breakpoint
ALTER TYPE "public"."check_in_method" ADD VALUE 'BIOMETRIC';--> statement-breakpoint
CREATE TABLE "biometric_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"device_name" text NOT NULL,
	"device_type" text,
	"ip_address" text,
	"firmware" text,
	"protocol" text DEFAULT 'ADMS' NOT NULL,
	"status" "biometric_device_status" DEFAULT 'OFFLINE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biometric_devices_serial_number_unique" UNIQUE("serial_number")
);
--> statement-breakpoint
CREATE TABLE "biometric_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_serial" text NOT NULL,
	"member_id" uuid,
	"device_user_id" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"event_type" "biometric_event_type" DEFAULT 'UNKNOWN' NOT NULL,
	"verify_method" "biometric_verification_method" DEFAULT 'UNKNOWN' NOT NULL,
	"raw_payload" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_hash" text,
	CONSTRAINT "biometric_events_event_hash_unique" UNIQUE("event_hash")
);
--> statement-breakpoint
CREATE TABLE "biometric_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "biometric_event_id" uuid;--> statement-breakpoint
ALTER TABLE "biometric_devices" ADD CONSTRAINT "biometric_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_devices" ADD CONSTRAINT "biometric_devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_devices" ADD CONSTRAINT "biometric_devices_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_events" ADD CONSTRAINT "biometric_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_events" ADD CONSTRAINT "biometric_events_device_id_biometric_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."biometric_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_events" ADD CONSTRAINT "biometric_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_events" ADD CONSTRAINT "biometric_events_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD CONSTRAINT "biometric_identities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD CONSTRAINT "biometric_identities_device_id_biometric_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."biometric_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_biometric_event_id_biometric_events_id_fk" FOREIGN KEY ("biometric_event_id") REFERENCES "public"."biometric_events"("id") ON DELETE set null ON UPDATE no action;