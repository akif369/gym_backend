ALTER TABLE "settings" DROP CONSTRAINT "settings_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "member_memberships" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "member_memberships" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "membership_events" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_events" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "report_exports" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "biometric_device_commands" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_memberships" ADD CONSTRAINT "member_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_memberships" ADD CONSTRAINT "member_memberships_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD CONSTRAINT "trainer_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD CONSTRAINT "trainer_assignments_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_device_commands" ADD CONSTRAINT "biometric_device_commands_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD CONSTRAINT "biometric_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_identities" ADD CONSTRAINT "biometric_identities_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;