-- Membership access boundaries are UTC instants. Existing end_date is an
-- inclusive final calendar day, so it maps to the following local midnight.
ALTER TABLE "member_memberships" ADD COLUMN "start_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "member_memberships" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "member_memberships" ADD COLUMN "timezone" text;
--> statement-breakpoint
UPDATE "member_memberships" AS membership
SET
  "timezone" = organization."timezone",
  "start_at" = membership."start_date"::timestamp AT TIME ZONE organization."timezone",
  "expires_at" = (membership."end_date" + 1)::timestamp AT TIME ZONE organization."timezone"
FROM "organizations" AS organization
WHERE organization."id" = membership."organization_id";
--> statement-breakpoint
ALTER TABLE "member_memberships" ALTER COLUMN "start_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_memberships" ALTER COLUMN "expires_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_memberships" ALTER COLUMN "timezone" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_memberships" ADD CONSTRAINT "membership_valid_window_check" CHECK ("expires_at" > "start_at");
--> statement-breakpoint
DROP INDEX IF EXISTS "membership_status_idx";
--> statement-breakpoint
CREATE INDEX "membership_member_access_idx" ON "member_memberships" ("member_id", "status", "start_at", "expires_at");
--> statement-breakpoint
CREATE INDEX "membership_expiry_pending_idx" ON "member_memberships" ("expires_at") WHERE "status" = 'ACTIVE';
--> statement-breakpoint
ALTER TABLE "member_memberships" DROP COLUMN "start_date";
--> statement-breakpoint
ALTER TABLE "member_memberships" DROP COLUMN "end_date";
--> statement-breakpoint

CREATE TYPE "public"."device_access_state_status" AS ENUM('PENDING', 'SENT', 'SYNCED', 'FAILED');
--> statement-breakpoint
CREATE TABLE "device_access_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "branch_id" uuid,
  "device_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "desired_group" integer NOT NULL,
  "applied_group" integer,
  "desired_version" integer DEFAULT 1 NOT NULL,
  "applied_version" integer DEFAULT 0 NOT NULL,
  "status" "device_access_state_status" DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "last_desired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_access_member_device_unique" UNIQUE("device_id", "member_id"),
  CONSTRAINT "device_access_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "device_access_states_device_id_biometric_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "biometric_devices"("id") ON DELETE cascade,
  CONSTRAINT "device_access_states_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE cascade,
  CONSTRAINT "device_access_states_branch_id_organization_id_branches_id_organization_id_fk" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id")
);
--> statement-breakpoint
-- Bring existing enrolled identities under durable reconciliation. Jittering
-- their first attempt avoids a deployment-time command burst at midnight.
INSERT INTO "device_access_states" (
  "organization_id", "branch_id", "device_id", "member_id",
  "desired_group", "desired_version", "applied_version", "status", "next_attempt_at"
)
SELECT
  identity."organization_id",
  identity."branch_id",
  identity."device_id",
  identity."member_id",
  CASE
    WHEN member."status" = 'ACTIVE' AND EXISTS (
      SELECT 1
      FROM "member_memberships" membership
      WHERE membership."member_id" = identity."member_id"
        AND membership."status" = 'ACTIVE'
        AND membership."start_at" <= NOW()
        AND membership."expires_at" > NOW()
    ) THEN 1
    ELSE 99
  END,
  1,
  0,
  'PENDING',
  NOW() + (mod((hashtextextended(identity."device_id"::text || ':' || identity."member_id"::text, 0) & 9223372036854775807), 300) * INTERVAL '1 second')
FROM "biometric_identities" identity
INNER JOIN "members" member ON member."id" = identity."member_id";
--> statement-breakpoint
CREATE INDEX "device_access_pending_idx" ON "device_access_states" ("next_attempt_at") WHERE "status" = 'PENDING';
--> statement-breakpoint
ALTER TABLE "biometric_device_commands" ADD COLUMN "access_state_id" uuid;
--> statement-breakpoint
ALTER TABLE "biometric_device_commands" ADD COLUMN "desired_version" integer;
--> statement-breakpoint
ALTER TABLE "biometric_device_commands" ADD CONSTRAINT "biometric_device_commands_access_state_id_device_access_states_id_fk" FOREIGN KEY ("access_state_id") REFERENCES "device_access_states"("id") ON DELETE set null;
