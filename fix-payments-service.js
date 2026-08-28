const fs = require('fs');
let content = fs.readFileSync('src/modules/payments/payments.service.ts', 'utf8');

// Imports
content = content.replace(
  "import { members } from '../../db/schema/members.schema';",
  "import { members } from '../../db/schema/members.schema';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';"
);

// generateInvoiceNumber
content = content.replace(
  "async function generateInvoiceNumber(orgId: string, prefix: string): Promise<string> {",
  "async function generateInvoiceNumber(ctx: TenantContext, prefix: string): Promise<string> {"
);
content = content.replace(
  "where(eq(invoices.organizationId, orgId))",
  "where(tenantWhere(invoices, ctx))"
);

// listPaymentsService
content = content.replace(
  "export async function listPaymentsService(orgId: string, query: Record<string, unknown>) {",
  "export async function listPaymentsService(ctx: TenantContext, query: Record<string, unknown>) {"
);
content = content.replace(
  "const conditions: any[] = [eq(paymentTransactions.organizationId, orgId)];",
  "const conditions: any[] = [tenantWhere(paymentTransactions, ctx), accessibleBranchesWhere(paymentTransactions, ctx)];"
);

// recordPaymentService
content = content.replace(
  "export async function recordPaymentService(\n  orgId: string,\n  data: {\n    memberId?: string;\n    amount: number;\n    gstAmount?: number;\n    paymentMethod: string;\n    referenceId?: string;\n    description?: string;\n    notes?: string;\n    idempotencyKey?: string;\n  },\n  actorId: string,\n) {",
  "export async function recordPaymentService(\n  ctx: TenantContext,\n  data: {\n    memberId?: string;\n    amount: number;\n    gstAmount?: number;\n    paymentMethod: string;\n    referenceId?: string;\n    description?: string;\n    notes?: string;\n    idempotencyKey?: string;\n  },\n) {"
);
content = content.replace(
  "eq(paymentTransactions.organizationId, orgId),",
  "tenantWhere(paymentTransactions, ctx),"
);
content = content.replace(
  "eq(members.organizationId, orgId),",
  "tenantWhere(members, ctx),"
);
content = content.replace(
  "      organizationId: orgId,\n      memberId: data.memberId,",
  "      organizationId: ctx.organizationId,\n      branchId: ctx.activeBranchId,\n      memberId: data.memberId,"
);
content = content.replace(
  "      recordedBy: actorId,\n      paidAt: new Date(),",
  "      recordedBy: ctx.userId,\n      paidAt: new Date(),"
);
content = content.replace(
  "    organizationId: orgId,\n    actorId,",
  "    organizationId: ctx.organizationId,\n    actorId: ctx.userId,"
);

// getPaymentService
content = content.replace(
  "export async function getPaymentService(orgId: string, paymentId: string) {",
  "export async function getPaymentService(ctx: TenantContext, paymentId: string) {"
);
content = content.replace(
  "where(and(eq(paymentTransactions.id, paymentId), eq(paymentTransactions.organizationId, orgId)))",
  "where(and(eq(paymentTransactions.id, paymentId), tenantWhere(paymentTransactions, ctx), accessibleBranchesWhere(paymentTransactions, ctx)))"
);

// refundPaymentService
content = content.replace(
  "export async function refundPaymentService(\n  orgId: string,\n  paymentId: string,\n  data: { amount: number; reason: string },\n  actorId: string,\n) {",
  "export async function refundPaymentService(\n  ctx: TenantContext,\n  paymentId: string,\n  data: { amount: number; reason: string },\n) {"
);
content = content.replace(
  "const payment = await getPaymentService(orgId, paymentId);",
  "const payment = await getPaymentService(ctx, paymentId);"
);
content = content.replace(
  "      processedBy: actorId,\n      processedAt: new Date(),",
  "      processedBy: ctx.userId,\n      processedAt: new Date(),"
);
content = content.replace(
  "    organizationId: orgId,\n    actorId,",
  "    organizationId: ctx.organizationId,\n    actorId: ctx.userId,"
);

// listInvoicesService
content = content.replace(
  "export async function listInvoicesService(orgId: string, query: Record<string, unknown>) {",
  "export async function listInvoicesService(ctx: TenantContext, query: Record<string, unknown>) {"
);
content = content.replace(
  "const conditions: any[] = [eq(invoices.organizationId, orgId)];",
  "const conditions: any[] = [tenantWhere(invoices, ctx), accessibleBranchesWhere(invoices, ctx)];"
);

// generateInvoiceService
content = content.replace(
  "export async function generateInvoiceService(\n  orgId: string,\n  data: {\n    memberId?: string;\n    membershipId?: string;\n    lineItems: { description: string; quantity: number; unitPrice: number; gstPercent: number }[];\n    notes?: string;\n    footer?: string;\n    dueDate?: string;\n  },\n  actorId: string,\n) {",
  "export async function generateInvoiceService(\n  ctx: TenantContext,\n  data: {\n    memberId?: string;\n    membershipId?: string;\n    lineItems: { description: string; quantity: number; unitPrice: number; gstPercent: number }[];\n    notes?: string;\n    footer?: string;\n    dueDate?: string;\n  },\n) {"
);
content = content.replace(
  "where(and(eq(members.id, data.memberId), eq(members.organizationId, orgId), isNull(members.deletedAt)))",
  "where(and(eq(members.id, data.memberId), tenantWhere(members, ctx), isNull(members.deletedAt)))"
);
content = content.replace(
  "const invoiceSettings = await getInvoiceSettingsService(orgId);",
  "const invoiceSettings = await getInvoiceSettingsService(ctx.organizationId);"
);
content = content.replace(
  "const taxSettings = await getTaxSettingsService(orgId);",
  "const taxSettings = await getTaxSettingsService(ctx.organizationId);"
);
content = content.replace(
  "      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice-number:${orgId}`}))`);\n      const invoiceNumber = await generateInvoiceNumber(orgId, invoiceSettings.prefix);\n      const [created] = await tx.insert(invoices).values({\n        organizationId: orgId,\n        memberId: data.memberId,",
  "      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice-number:${ctx.organizationId}`}))`);\n      const invoiceNumber = await generateInvoiceNumber(ctx, invoiceSettings.prefix);\n      const [created] = await tx.insert(invoices).values({\n        organizationId: ctx.organizationId,\n        branchId: ctx.activeBranchId,\n        memberId: data.memberId,"
);
content = content.replace(
  "        createdBy: actorId,\n      }).returning();",
  "        createdBy: ctx.userId,\n      }).returning();"
);
content = content.replace(
  "    organizationId: orgId,\n    actorId,",
  "    organizationId: ctx.organizationId,\n    actorId: ctx.userId,"
);

// generateMembershipInvoiceService
content = content.replace(
  "export async function generateMembershipInvoiceService(\n  orgId: string,\n  data: { memberId: string; membershipId: string; planName: string; price: string; gstPercent: string; notes?: string },\n  actorId: string,\n) {",
  "export async function generateMembershipInvoiceService(\n  ctx: TenantContext,\n  data: { memberId: string; membershipId: string; planName: string; price: string; gstPercent: string; notes?: string },\n) {"
);
content = content.replace(
  "where(and(eq(invoices.organizationId, orgId), eq(invoices.membershipId, data.membershipId)))",
  "where(and(tenantWhere(invoices, ctx), eq(invoices.membershipId, data.membershipId)))"
);
content = content.replace(
  "if (existing) return getInvoiceService(orgId, existing.id);",
  "if (existing) return getInvoiceService(ctx, existing.id);"
);
content = content.replace(
  "return generateInvoiceService(orgId, {",
  "return generateInvoiceService(ctx, {"
);
content = content.replace(
  "    notes: data.notes,\n  }, actorId);",
  "    notes: data.notes,\n  });"
);

// getInvoiceService
content = content.replace(
  "export async function getInvoiceService(orgId: string, invoiceId: string) {",
  "export async function getInvoiceService(ctx: TenantContext, invoiceId: string) {"
);
content = content.replace(
  "where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, orgId)))",
  "where(and(eq(invoices.id, invoiceId), tenantWhere(invoices, ctx), accessibleBranchesWhere(invoices, ctx)))"
);


// sendInvoiceWhatsAppService
content = content.replace(
  "export async function sendInvoiceWhatsAppService(orgId: string, invoiceId: string, actorId: string) {",
  "export async function sendInvoiceWhatsAppService(ctx: TenantContext, invoiceId: string) {"
);
content = content.replace(
  "const invoice = await getInvoiceService(orgId, invoiceId);",
  "const invoice = await getInvoiceService(ctx, invoiceId);"
);
content = content.replace(
  "eq(members.organizationId, orgId),",
  "tenantWhere(members, ctx),"
);
content = content.replace(
  "const invoiceSettings = await getInvoiceSettingsService(orgId);",
  "const invoiceSettings = await getInvoiceSettingsService(ctx.organizationId);"
);
content = content.replace(
  "      organizationId: orgId,\n      memberId: member.id,",
  "      organizationId: ctx.organizationId,\n      memberId: member.id,"
);
content = content.replace(
  "      organizationId: orgId,\n      memberId: member.id,",
  "      organizationId: ctx.organizationId,\n      memberId: member.id,"
);
content = content.replace(
  "      idempotencyKey,\n      actorId,\n    });",
  "      idempotencyKey,\n      actorId: ctx.userId,\n    });"
);
content = content.replace(
  "      idempotencyKey,\n      actorId,\n    });",
  "      idempotencyKey,\n      actorId: ctx.userId,\n    });"
);
content = content.replace(
  "    organizationId: orgId,\n    actorId,",
  "    organizationId: ctx.organizationId,\n    actorId: ctx.userId,"
);

// getMemberPaymentsService
content = content.replace(
  "export async function getMemberPaymentsService(orgId: string, memberId: string, query: Record<string, unknown>) {",
  "export async function getMemberPaymentsService(ctx: TenantContext, memberId: string, query: Record<string, unknown>) {"
);
content = content.replace(
  "where(and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt)))",
  "where(and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt)))"
);

fs.writeFileSync('src/modules/payments/payments.service.ts', content);
console.log('Fixed payments.service.ts');
