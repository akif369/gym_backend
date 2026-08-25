import { pgTable, uuid, text, timestamp, pgEnum, foreignKey, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './org.schema';
import { branches } from './org.schema';
import { members } from './members.schema';
import { users } from './auth.schema';
import { biometricEvents } from './biometrics.schema';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const checkInMethodEnum = pgEnum('check_in_method', [
  'MANUAL',
  'QR',
  'RFID',
  'APP',
  'BIOMETRIC',
]);

export const checkOutMethodEnum = pgEnum('check_out_method', [
  'MANUAL',
  'AUTO',
  'ADMIN',
  'SYSTEM',
]);

// ── Attendance Logs ───────────────────────────────────────────────────────────

export const attendanceLogs = pgTable('attendance_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' }),
  memberName: text('member_name').notNull(), // denormalized for performance
  checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull(),
  checkOutAt: timestamp('check_out_at', { withTimezone: true }),
  biometricEventId: uuid('biometric_event_id').references(() => biometricEvents.id, { onDelete: 'set null' }),
  checkInMethod: checkInMethodEnum('check_in_method').notNull().default('MANUAL'),
  checkOutMethod: checkOutMethodEnum('check_out_method'),
  checkOutReason: text('check_out_reason'),
  checkInBy: uuid('check_in_by').references(() => users.id), // staff who did the check-in
  checkOutBy: uuid('check_out_by').references(() => users.id),
  notes: text('notes'),
  correctedAt: timestamp('corrected_at', { withTimezone: true }),
  correctedBy: uuid('corrected_by').references(() => users.id),
  correctionReason: text('correction_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
  index('attendance_auto_checkout_idx').on(table.organizationId, table.branchId, table.checkInAt).where(sql`check_out_at IS NULL`),
]);

// ── Type Exports ──────────────────────────────────────────────────────────────

export type AttendanceLog = typeof attendanceLogs.$inferSelect;
export type NewAttendanceLog = typeof attendanceLogs.$inferInsert;
