ALTER TABLE "biometric_identities" ADD COLUMN "access_group" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD COLUMN "sync_status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD COLUMN "last_synced_at" timestamp with time zone;