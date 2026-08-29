ALTER TYPE "biometric_command_status" ADD VALUE IF NOT EXISTS 'CANCELLED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_commands_pending_device_idx"
  ON "biometric_device_commands" ("device_id", "created_at")
  WHERE "status" = 'PENDING';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_commands_access_state_version_idx"
  ON "biometric_device_commands" ("access_state_id", "desired_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biometric_devices_online_last_seen_idx"
  ON "biometric_devices" ("last_seen_at")
  WHERE "status" = 'ONLINE';
