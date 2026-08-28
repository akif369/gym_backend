import { pgTable, uuid, text, timestamp, foreignKey } from 'drizzle-orm/pg-core';
import { organizations, branches } from './org.schema';
import { members } from './members.schema';
import { invoices } from './payments.schema';

// Delivery records make automatic notifications observable and safe to retry.
export const messageDeliveries = pgTable('message_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id'),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  recipient: text('recipient').notNull(),
  message: text('message').notNull(),
  provider: text('provider').notNull().default('EVOLUTION_GO'),
  providerMessageId: text('provider_message_id'),
  status: text('status', { enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] }).notNull().default('PENDING'),
  errorMessage: text('error_message'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId, table.organizationId],
    foreignColumns: [branches.id, branches.organizationId],
  }),
]);

export type MessageDelivery = typeof messageDeliveries.$inferSelect;
