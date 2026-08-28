import { pgTable, uuid, text, timestamp, numeric, integer, pgEnum, boolean, uniqueIndex, check, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './org.schema';
import { branches } from './org.schema';
import { members } from './members.schema';
import { users } from './auth.schema';
import { memberMemberships } from './memberships.schema';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const paymentMethodEnum = pgEnum('payment_method', [
  'CASH',
  'CARD',
  'UPI',
  'NETBANKING',
  'CHEQUE',
  'OTHER',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'PAID',
  'PENDING',
  'PARTIALLY_PAID',
  'FAILED',
  'REFUNDED',
  'CANCELLED',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT',
  'SENT',
  'PAID',
  'PARTIALLY_PAID',
  'OVERDUE',
  'CANCELLED',
]);

// ── Payment Transactions (Immutable Ledger) ───────────────────────────────────

export const paymentTransactions = pgTable('payment_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id'),
  memberId: uuid('member_id').references(() => members.id),
  invoiceId: uuid('invoice_id'), // set after invoice is created — circular ref handled at app level
  memberName: text('member_name'), // denormalized
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  gstAmount: numeric('gst_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  status: paymentStatusEnum('status').notNull().default('PAID'),
  referenceId: text('reference_id'), // UPI ref, card auth code, cheque number etc.
  description: text('description'),
  notes: text('notes'),
  idempotencyKey: text('idempotency_key').unique(),
  recordedBy: uuid('recorded_by').references(() => users.id),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
  check('payments_amount_check', sql`${table.amount} >= 0`),
  check('payments_gst_check', sql`${table.gstAmount} >= 0`),
  check('payments_total_check', sql`${table.totalAmount} >= 0`),
]);

// ── Invoices ──────────────────────────────────────────────────────────────────

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id'),
  memberId: uuid('member_id').references(() => members.id),
  membershipId: uuid('membership_id').references(() => memberMemberships.id, { onDelete: 'set null' }),
  memberName: text('member_name'), // denormalized
  invoiceNumber: text('invoice_number').notNull(), // e.g. GYM-2026-001
  publicToken: text('public_token').notNull().unique(),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  gstAmount: numeric('gst_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull().default('18'),
  // Snapshot the pricing mode so an invoice remains accurate if tax settings change later.
  taxIncluded: boolean('tax_included').notNull().default(false),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  status: invoiceStatusEnum('status').notNull().default('DRAFT'),
  dueDate: timestamp('due_date', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  notes: text('notes'),
  footer: text('footer'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('invoices_organization_invoice_number_unique').on(table.organizationId, table.invoiceNumber),
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Invoice Line Items ─────────────────────────────────────────────────────────

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull().default('18'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Refunds ───────────────────────────────────────────────────────────────────

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => paymentTransactions.id, { onDelete: 'restrict' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['PENDING', 'PROCESSED', 'FAILED'] }).notNull().default('PENDING'),
  referenceId: text('reference_id'),
  processedBy: uuid('processed_by').references(() => users.id),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Report Exports ─────────────────────────────────────────────────────────────

export const reportExports = pgTable('report_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  type: text('type').notNull(), // 'attendance' | 'revenue' | 'memberships' | 'trainers' | 'pt-sessions'
  format: text('format', { enum: ['CSV', 'PDF'] }).notNull().default('CSV'),
  status: text('status', { enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] }).notNull().default('PENDING'),
  filePath: text('file_path'),
  filters: text('filters'), // JSON string of applied filters
  errorMessage: text('error_message'),
  requestedBy: uuid('requested_by').references(() => users.id),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

// ── Type Exports ──────────────────────────────────────────────────────────────

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
export type ReportExport = typeof reportExports.$inferSelect;
export type NewReportExport = typeof reportExports.$inferInsert;
