import { pgTable, uuid, text, timestamp, pgEnum, foreignKey } from 'drizzle-orm/pg-core';
import { organizations } from './org.schema';
import { branches } from './org.schema';
import { users } from './auth.schema';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const leadStatusEnum = pgEnum('lead_status', [
  'NEW_LEAD',
  'CONTACTED',
  'TRIAL_BOOKED',
  'TRIAL_COMPLETED',
  'JOINED',
  'LOST',
]);

export const leadSourceEnum = pgEnum('lead_source', [
  'INSTAGRAM',
  'FACEBOOK',
  'GOOGLE',
  'WALK_IN',
  'REFERRAL',
  'WHATSAPP',
  'WEBSITE',
  'OTHER',
]);

export const leadActivityTypeEnum = pgEnum('lead_activity_type', [
  'CALL',
  'NOTE',
  'VISIT',
  'EMAIL',
  'WHATSAPP',
  'TRIAL',
]);

// ── Leads ─────────────────────────────────────────────────────────────────────

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone').notNull(),
  source: leadSourceEnum('source').notNull().default('OTHER'),
  status: leadStatusEnum('status').notNull().default('NEW_LEAD'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  notes: text('notes'),
  interestedIn: text('interested_in'), // which plan / service
  convertedMemberId: uuid('converted_member_id'), // set when JOINED
  createdBy: uuid('created_by').references(() => users.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Lead Activities ────────────────────────────────────────────────────────────

export const leadActivities = pgTable('lead_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  leadId: uuid('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  activityType: leadActivityTypeEnum('activity_type').notNull(),
  notes: text('notes').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: text('actor_name'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Type Exports ──────────────────────────────────────────────────────────────

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadActivity = typeof leadActivities.$inferSelect;
export type NewLeadActivity = typeof leadActivities.$inferInsert;
