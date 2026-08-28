import { pgTable, uuid, text, timestamp, integer, pgEnum, date, foreignKey } from 'drizzle-orm/pg-core';
import { organizations } from './org.schema';
import { branches } from './org.schema';
import { members } from './members.schema';
import { users } from './auth.schema';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const trainerStatusEnum = pgEnum('trainer_status', [
  'ACTIVE',
  'ON_LEAVE',
  'INACTIVE',
]);

// ── Trainers ──────────────────────────────────────────────────────────────────

export const trainers = pgTable('trainers', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone').notNull(),
  specialization: text('specialization'),
  certifications: text('certifications'),
  photoUrl: text('photo_url'),
  shift: text('shift'),
  status: trainerStatusEnum('status').notNull().default('ACTIVE'),
  joiningDate: date('joining_date'),
  notes: text('notes'),
  // Linked user account (optional — trainer may also be a staff user)
  userId: uuid('user_id').references(() => users.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Trainer Assignments ───────────────────────────────────────────────────────

export const trainerAssignments = pgTable('trainer_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  trainerId: uuid('trainer_id')
    .notNull()
    .references(() => trainers.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' }),
  assignedBy: uuid('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  unassignedAt: timestamp('unassigned_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Type Exports ──────────────────────────────────────────────────────────────

export type Trainer = typeof trainers.$inferSelect;
export type NewTrainer = typeof trainers.$inferInsert;
export type TrainerAssignment = typeof trainerAssignments.$inferSelect;
export type NewTrainerAssignment = typeof trainerAssignments.$inferInsert;
