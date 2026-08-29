import { pgTable, uuid, text, timestamp, integer, boolean, numeric, jsonb, date, pgEnum, check, index, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, branches } from './org.schema';
import { members } from './members.schema';
import { users } from './auth.schema';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const membershipStatusEnum = pgEnum('membership_status', [
  'PENDING',
  'ACTIVE',
  'FROZEN',
  'EXPIRED',
  'CANCELLED',
]);

export const membershipEventTypeEnum = pgEnum('membership_event_type', [
  'CREATED',
  'ACTIVATED',
  'RENEWED',
  'UPGRADED',
  'DOWNGRADED',
  'FROZEN',
  'RESUMED',
  'EXTENDED',
  'CANCELLED',
  'TRANSFERRED',
]);

// ── Membership Plans ──────────────────────────────────────────────────────────

export const membershipPlans = pgTable('membership_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  name: text('name').notNull(),
  description: text('description'),
  durationDays: integer('duration_days').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull().default('18'),
  joiningFee: numeric('joining_fee', { precision: 12, scale: 2 }).notNull().default('0'),
  ptSessionsIncluded: integer('pt_sessions_included').notNull().default(0),
  features: jsonb('features').default('[]'), // string[] list of features
  status: text('status', { enum: ['ACTIVE', 'INACTIVE'] }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('plans_price_check', sql`${table.price} >= 0`),
  check('plans_duration_check', sql`${table.durationDays} > 0`),
  check('plans_gst_check', sql`${table.gstPercent} >= 0 AND ${table.gstPercent} <= 100`),
  check('plans_joining_fee_check', sql`${table.joiningFee} >= 0`),
  check('plans_pt_sessions_check', sql`${table.ptSessionsIncluded} >= 0`),
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Member Memberships ────────────────────────────────────────────────────────

export const memberMemberships = pgTable('member_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').references(() => membershipPlans.id),
  planName: text('plan_name').notNull(), // denormalized snapshot
  // Canonical access boundaries. startAt is inclusive, expiresAt is exclusive.
  // Both are UTC instants; timezone snapshots the business timezone used to
  // calculate their local-midnight boundaries.
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull(),
  status: membershipStatusEnum('status').notNull().default('PENDING'),
  freezeStartDate: date('freeze_start_date'),
  freezeEndDate: date('freeze_end_date'),
  frozenDays: integer('frozen_days').notNull().default(0),
  ptSessionsTotal: integer('pt_sessions_total').notNull().default(0),
  ptSessionsUsed: integer('pt_sessions_used').notNull().default(0),
  idempotencyKey: text('idempotency_key').unique(), // for renewal/mutation dedup
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('memberships_pt_total_check', sql`${table.ptSessionsTotal} >= 0`),
  check('memberships_pt_used_check', sql`${table.ptSessionsUsed} >= 0 AND ${table.ptSessionsUsed} <= ${table.ptSessionsTotal}`),
  check('memberships_frozen_days_check', sql`${table.frozenDays} >= 0`),
  index('membership_member_access_idx').on(table.memberId, table.status, table.startAt, table.expiresAt),
  index('membership_expiry_pending_idx').on(table.expiresAt).where(sql`${table.status} = 'ACTIVE'`),
  check('membership_valid_window_check', sql`${table.expiresAt} > ${table.startAt}`),
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Membership Events (Immutable Ledger) ──────────────────────────────────────

export const membershipEvents = pgTable('membership_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  membershipId: uuid('membership_id').references(() => memberMemberships.id),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' }),
  eventType: membershipEventTypeEnum('event_type').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: text('actor_name'), // denormalized snapshot
  notes: text('notes'),
  metadata: jsonb('metadata').default('{}'), // plan snapshot, dates, etc.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Type Exports ──────────────────────────────────────────────────────────────

export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type NewMembershipPlan = typeof membershipPlans.$inferInsert;
export type MemberMembership = typeof memberMemberships.$inferSelect;
export type NewMemberMembership = typeof memberMemberships.$inferInsert;
export type MembershipEvent = typeof membershipEvents.$inferSelect;
export type NewMembershipEvent = typeof membershipEvents.$inferInsert;
