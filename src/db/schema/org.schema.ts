import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, uniqueIndex, unique, check, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * Controls whether the organization runs a single gym or multiple branches.
 *
 * SINGLE_GYM  — One gym, simplified UX. "Branches" are hidden from the org admin
 *               dashboard. Internally still uses the Organization → Branch hierarchy.
 * MULTI_GYM   — Multiple branches/locations. Full branch management UI is shown.
 *
 * Upgrading SINGLE_GYM → MULTI_GYM is always allowed.
 * Downgrading MULTI_GYM → SINGLE_GYM is only allowed when exactly 1 active branch exists.
 */
export const organizationModeEnum = pgEnum('organization_mode', [
  'SINGLE_GYM',
  'MULTI_GYM',
]);

// ── Organizations ─────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),

  /**
   * Determines which features and navigation are visible to the org admin.
   * Does NOT affect the underlying data model — always Organization → Branch → Members.
   */
  organizationMode: organizationModeEnum('organization_mode').notNull().default('SINGLE_GYM'),

  logoUrl: text('logo_url'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  country: text('country').default('India'),
  gstNumber: text('gst_number'),
  currency: text('currency').default('INR').notNull(),
  timezone: text('timezone').default('Asia/Kolkata').notNull(),
  status: text('status', { enum: ['ACTIVE', 'SUSPENDED'] }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Branches ──────────────────────────────────────────────────────────────────

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
  .notNull()
  .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  city: text('city'),
  phone: text('phone'),
  email: text('email'),
  capacity: integer('capacity').default(0),
  status: text('status', { enum: ['ACTIVE', 'INACTIVE'] }).notNull().default('ACTIVE'),
  isMainBranch: boolean('is_main_branch').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('branches_id_org_unique').on(table.id, table.organizationId),
  check('branches_capacity_check', sql`${table.capacity} >= 0`),
]);

// ── Settings ──────────────────────────────────────────────────────────────────
// Flexible key-value settings scoped to org or branch

export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
  .notNull()
  .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'), // NULL = org-wide setting. references branches(id, organization_id) separately
  category: text('category').notNull(), // 'gym-profile' | 'attendance' | 'tax' | 'invoice' | 'hardware'
  value: jsonb('value').notNull().default('{}'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // If branchId is NULL, PG treats them as distinct unless we use coalesce or conditional index.
  // Using conditional unique index for org-level and standard unique for branch-level:
  uniqueIndex('settings_org_category_unique').on(table.organizationId, table.category).where(sql`${table.branchId} IS NULL`),
  uniqueIndex('settings_org_branch_category_unique').on(table.organizationId, table.branchId, table.category).where(sql`${table.branchId} IS NOT NULL`),
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }).onDelete('cascade'),
]);

// ── Type Exports ──────────────────────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export type OrganizationMode = 'SINGLE_GYM' | 'MULTI_GYM';
