import { pgTable, uuid, text, timestamp, pgEnum, foreignKey, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, branches } from './org.schema';
import { members } from './members.schema';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const biometricDeviceStatusEnum = pgEnum('biometric_device_status', [
  'ONLINE',
  'OFFLINE',
  'ERROR',
]);

export const biometricCommandStatusEnum = pgEnum('biometric_command_status', [
  'PENDING',
  'SENT',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const deviceAccessStateStatusEnum = pgEnum('device_access_state_status', [
  'PENDING',
  'SENT',
  'SYNCED',
  'FAILED',
]);

export const biometricDevicePurposeEnum = pgEnum('biometric_device_purpose', [
  'ENTRY',
  'EXIT',
  'VIDEO',
  'OTHER',
]);

export const biometricVerificationMethodEnum = pgEnum('biometric_verification_method', [
  'FACE',
  'FINGERPRINT',
  'CARD',
  'PASSWORD',
  'UNKNOWN',
]);

export const biometricEventTypeEnum = pgEnum('biometric_event_type', [
  'CHECK_IN',
  'CHECK_OUT',
  'UNKNOWN',
]);

// ── Devices ───────────────────────────────────────────────────────────────────

export const biometricDevices = pgTable('biometric_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'cascade' }),
  serialNumber: text('serial_number').notNull().unique(),
  deviceName: text('device_name').notNull(),
  deviceType: text('device_type'), // e.g. 'F09'
  ipAddress: text('ip_address'),
  firmware: text('firmware'),
  protocol: text('protocol').default('ADMS').notNull(),
  purpose: biometricDevicePurposeEnum('purpose').default('OTHER').notNull(),
  status: biometricDeviceStatusEnum('status').default('OFFLINE').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Raw Events ────────────────────────────────────────────────────────────────

export const biometricEvents = pgTable('biometric_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id')
    .notNull(),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => biometricDevices.id, { onDelete: 'cascade' }),
  deviceSerial: text('device_serial').notNull(),
  memberId: uuid('member_id')
    .references(() => members.id, { onDelete: 'set null' }), // can be null if not mapped yet
  deviceUserId: text('device_user_id').notNull(),
  eventTime: timestamp('event_time', { withTimezone: true }).notNull(),
  eventType: biometricEventTypeEnum('event_type').default('UNKNOWN').notNull(),
  verifyMethod: biometricVerificationMethodEnum('verify_method').default('UNKNOWN').notNull(),
  rawPayload: text('raw_payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  eventHash: text('event_hash').unique(), // to prevent duplicates
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Identity Mapping ──────────────────────────────────────────────────────────

export const biometricIdentities = pgTable('biometric_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => biometricDevices.id, { onDelete: 'cascade' }),
  deviceUserId: text('device_user_id').notNull(),
  accessGroup: integer('access_group').default(1).notNull(), // 1 = Active / Allowed, 99 = Denied
  syncStatus: text('sync_status').default('PENDING').notNull(), // 'PENDING' | 'SYNCED' | 'FAILED'
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Commands ──────────────────────────────────────────────────────────────────

export const biometricDeviceCommands = pgTable('biometric_device_commands', {
  id: uuid('id').primaryKey().defaultRandom(),
  admsCommandId: integer('adms_command_id').unique(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => biometricDevices.id, { onDelete: 'cascade' }),
  deviceSerial: text('device_serial').notNull(),
  accessStateId: uuid('access_state_id'),
  desiredVersion: integer('desired_version'),
  commandString: text('command_string').notNull(), // e.g. 'DATA UPDATE USER PIN=1001 Name=John'
  status: biometricCommandStatusEnum('status').default('PENDING').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// Durable desired-state projection for physical access. Membership writes record
// the desired group atomically; asynchronous ADMS delivery only projects it.
export const deviceAccessStates = pgTable('device_access_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  deviceId: uuid('device_id').notNull().references(() => biometricDevices.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  desiredGroup: integer('desired_group').notNull(),
  appliedGroup: integer('applied_group'),
  desiredVersion: integer('desired_version').notNull().default(1),
  appliedVersion: integer('applied_version').notNull().default(0),
  status: deviceAccessStateStatusEnum('status').notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  lastDesiredAt: timestamp('last_desired_at', { withTimezone: true }).notNull().defaultNow(),
  lastAppliedAt: timestamp('last_applied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('device_access_member_device_unique').on(table.deviceId, table.memberId),
  index('device_access_pending_idx').on(table.nextAttemptAt).where(sql`${table.status} = 'PENDING'`),
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Type Exports ──────────────────────────────────────────────────────────────

export type BiometricDevice = typeof biometricDevices.$inferSelect;
export type NewBiometricDevice = typeof biometricDevices.$inferInsert;
export type BiometricEvent = typeof biometricEvents.$inferSelect;
export type NewBiometricEvent = typeof biometricEvents.$inferInsert;
export type BiometricIdentity = typeof biometricIdentities.$inferSelect;
export type NewBiometricIdentity = typeof biometricIdentities.$inferInsert;
export type BiometricDeviceCommand = typeof biometricDeviceCommands.$inferSelect;
export type NewBiometricDeviceCommand = typeof biometricDeviceCommands.$inferInsert;
export type DeviceAccessState = typeof deviceAccessStates.$inferSelect;
export type NewDeviceAccessState = typeof deviceAccessStates.$inferInsert;
