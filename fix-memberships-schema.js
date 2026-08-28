const fs = require('fs');

const path = 'src/db/schema/memberships.schema.ts';
let content = fs.readFileSync(path, 'utf8');

// 1. Add branches to imports
content = content.replace(
  "import { organizations } from './org.schema';",
  "import { organizations, branches } from './org.schema';"
);
content = content.replace(
  "import { pgTable, uuid, text, timestamp, integer, boolean, numeric, jsonb, date, pgEnum, check, index } from 'drizzle-orm/pg-core';",
  "import { pgTable, uuid, text, timestamp, integer, boolean, numeric, jsonb, date, pgEnum, check, index, foreignKey } from 'drizzle-orm/pg-core';"
);

// 2. Add branchId to membershipPlans and composite FK
content = content.replace(
  "  organizationId: uuid('organization_id')\n    .notNull()\n    .references(() => organizations.id, { onDelete: 'cascade' }),",
  "  organizationId: uuid('organization_id')\n    .notNull()\n    .references(() => organizations.id, { onDelete: 'cascade' }),\n  branchId: uuid('branch_id'),"
);
content = content.replace(
  "  check('plans_pt_sessions_check', sql`${table.ptSessionsIncluded} >= 0`),",
  "  check('plans_pt_sessions_check', sql`${table.ptSessionsIncluded} >= 0`),\n  foreignKey({\n    columns: [table.branchId, table.organizationId],\n    foreignColumns: [branches.id, branches.organizationId],\n  }),"
);

// 3. Add organizationId and branchId to memberMemberships
content = content.replace(
  "  memberId: uuid('member_id')\n    .notNull()\n    .references(() => members.id, { onDelete: 'cascade' }),",
  "  organizationId: uuid('organization_id')\n    .notNull()\n    .references(() => organizations.id, { onDelete: 'cascade' }),\n  branchId: uuid('branch_id'),\n  memberId: uuid('member_id')\n    .notNull()\n    .references(() => members.id, { onDelete: 'cascade' }),"
);
content = content.replace(
  "  index('membership_status_idx').on(table.memberId, table.status, table.endDate),",
  "  index('membership_status_idx').on(table.memberId, table.status, table.endDate),\n  foreignKey({\n    columns: [table.branchId, table.organizationId],\n    foreignColumns: [branches.id, branches.organizationId],\n  }),"
);

// 4. Add organizationId and branchId to membershipEvents
content = content.replace(
  "  membershipId: uuid('membership_id').references(() => memberMemberships.id),",
  "  organizationId: uuid('organization_id')\n    .notNull()\n    .references(() => organizations.id, { onDelete: 'cascade' }),\n  branchId: uuid('branch_id'),\n  membershipId: uuid('membership_id').references(() => memberMemberships.id),"
);
content = content.replace(
  "  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),\n});",
  "  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),\n}, (table) => [\n  foreignKey({\n    columns: [table.branchId, table.organizationId],\n    foreignColumns: [branches.id, branches.organizationId],\n  }),\n]);"
);

fs.writeFileSync(path, content);
console.log('Done fixing memberships.schema.ts');
