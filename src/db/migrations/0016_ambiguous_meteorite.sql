ALTER TABLE "members" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deletion_reason" text;