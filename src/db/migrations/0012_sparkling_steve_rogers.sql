CREATE TYPE "public"."biometric_command_status" AS ENUM('PENDING', 'SENT', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "biometric_device_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_serial" text NOT NULL,
	"command_string" text NOT NULL,
	"status" "biometric_command_status" DEFAULT 'PENDING' NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "biometric_device_commands" ADD CONSTRAINT "biometric_device_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_device_commands" ADD CONSTRAINT "biometric_device_commands_device_id_biometric_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."biometric_devices"("id") ON DELETE cascade ON UPDATE no action;