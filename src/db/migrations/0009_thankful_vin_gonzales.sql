CREATE TYPE "public"."check_out_method" AS ENUM('MANUAL', 'AUTO', 'ADMIN', 'SYSTEM');--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "check_out_method" "check_out_method";--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "check_out_reason" text;--> statement-breakpoint
CREATE INDEX "membership_status_idx" ON "member_memberships" USING btree ("member_id","status","end_date");--> statement-breakpoint
CREATE INDEX "attendance_auto_checkout_idx" ON "attendance_logs" USING btree ("organization_id","branch_id","check_in_at") WHERE check_out_at IS NULL;