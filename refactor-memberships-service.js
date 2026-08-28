const fs = require('fs');
let content = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');

// Imports
content = content.replace(
  "import { eq, and, isNull, desc, asc, count, sql, lt, ne, inArray } from 'drizzle-orm';",
  "import { eq, and, isNull, desc, asc, count, sql, lt, ne, inArray } from 'drizzle-orm';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';"
);

// emitEvent
content = content.replace(
  "async function emitEvent(\n  membershipId: string | null,\n  memberId: string,\n  eventType: typeof membershipEvents.$inferInsert['eventType'],\n  actorId?: string,\n  actorName?: string,",
  "async function emitEvent(\n  ctx: TenantContext,\n  membershipId: string | null,\n  memberId: string,\n  eventType: typeof membershipEvents.$inferInsert['eventType'],\n  actorName?: string,"
);
content = content.replace(
  "  await tx.insert(membershipEvents).values({\n    membershipId,\n    memberId,\n    eventType,\n    actorId,",
  "  await tx.insert(membershipEvents).values({\n    organizationId: ctx.organizationId,\n    branchId: ctx.activeBranchId,\n    membershipId,\n    memberId,\n    eventType,\n    actorId: ctx.userId,"
);

// sendRenewalNotification
content = content.replace(
  "async function sendRenewalNotification(\n  orgId: string,\n  memberId: string,\n  membership: typeof memberMemberships.$inferSelect,\n  plan: typeof membershipPlans.$inferSelect,\n  actorId: string,\n  invoiceAmount?: number,\n) {",
  "async function sendRenewalNotification(\n  ctx: TenantContext,\n  memberId: string,\n  membership: typeof memberMemberships.$inferSelect,\n  plan: typeof membershipPlans.$inferSelect,\n  invoiceAmount?: number,\n) {"
);
content = content.replace(/generateMembershipInvoiceService\(orgId, \{/g, 'generateMembershipInvoiceService(ctx.organizationId, {');
content = content.replace(/ \}, actorId\);/g, ' }, ctx.userId);');
content = content.replace(/getInvoiceSettingsService\(orgId\);/g, 'getInvoiceSettingsService(ctx.organizationId);');
content = content.replace(
  "eq(members.organizationId, orgId)",
  "tenantWhere(members, ctx)"
);
content = content.replace(
  "      organizationId: orgId,\n      memberId,\n      invoiceId: invoice.id,\n      eventType: 'MEMBERSHIP_RENEWED',\n      phone: member.phone,\n      text,\n      pdfBuffer,\n      filename: `Invoice_${invoice.invoiceNumber}.pdf`,\n      idempotencyKey: `membership-renewed:${membership.id}`,\n      actorId,",
  "      organizationId: ctx.organizationId,\n      memberId,\n      invoiceId: invoice.id,\n      eventType: 'MEMBERSHIP_RENEWED',\n      phone: member.phone,\n      text,\n      pdfBuffer,\n      filename: `Invoice_${invoice.invoiceNumber}.pdf`,\n      idempotencyKey: `membership-renewed:${membership.id}`,\n      actorId: ctx.userId,"
);
content = content.replace(
  "      organizationId: orgId,\n      memberId,\n      invoiceId: invoice.id,\n      eventType: 'MEMBERSHIP_RENEWED',\n      phone: member.phone,\n      text,\n      idempotencyKey: `membership-renewed:${membership.id}`,\n      actorId,",
  "      organizationId: ctx.organizationId,\n      memberId,\n      invoiceId: invoice.id,\n      eventType: 'MEMBERSHIP_RENEWED',\n      phone: member.phone,\n      text,\n      idempotencyKey: `membership-renewed:${membership.id}`,\n      actorId: ctx.userId,"
);

// listPlansService
content = content.replace(
  "export async function listPlansService(orgId: string) {",
  "export async function listPlansService(ctx: TenantContext) {"
);
content = content.replace(
  "eq(membershipPlans.organizationId, orgId)",
  "and(tenantWhere(membershipPlans, ctx), accessibleBranchesWhere(membershipPlans, ctx))"
);

// createPlanService
content = content.replace(
  "export async function createPlanService(orgId: string, data: Omit<typeof membershipPlans.$inferInsert, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>) {",
  "export async function createPlanService(ctx: TenantContext, data: Omit<typeof membershipPlans.$inferInsert, 'id' | 'organizationId' | 'branchId' | 'createdAt' | 'updatedAt'>) {"
);
content = content.replace(
  "{ ...data, organizationId: orgId }",
  "{ ...data, organizationId: ctx.organizationId, branchId: ctx.activeBranchId }"
);

// getPlanService
content = content.replace(
  "export async function getPlanService(orgId: string, planId: string) {",
  "export async function getPlanService(ctx: TenantContext, planId: string) {"
);
content = content.replace(
  "and(eq(membershipPlans.id, planId), eq(membershipPlans.organizationId, orgId))",
  "and(eq(membershipPlans.id, planId), tenantWhere(membershipPlans, ctx), accessibleBranchesWhere(membershipPlans, ctx))"
);

// updatePlanService
content = content.replace(
  "export async function updatePlanService(orgId: string, planId: string, data: Partial<typeof membershipPlans.$inferInsert>) {",
  "export async function updatePlanService(ctx: TenantContext, planId: string, data: Partial<typeof membershipPlans.$inferInsert>) {"
);
content = content.replace(
  "await getPlanService(orgId, planId);",
  "await getPlanService(ctx, planId);"
);

// updatePlanStatusService
content = content.replace(
  "export async function updatePlanStatusService(orgId: string, planId: string, status: 'ACTIVE' | 'INACTIVE') {",
  "export async function updatePlanStatusService(ctx: TenantContext, planId: string, status: 'ACTIVE' | 'INACTIVE') {"
);
content = content.replace(
  "await getPlanService(orgId, planId);",
  "await getPlanService(ctx, planId);"
);

// deletePlanService
content = content.replace(
  "export async function deletePlanService(orgId: string, planId: string) {",
  "export async function deletePlanService(ctx: TenantContext, planId: string) {"
);
content = content.replace(
  "await getPlanService(orgId, planId);",
  "await getPlanService(ctx, planId);"
);
content = content.replace(
  "and(eq(membershipPlans.id, planId), eq(membershipPlans.organizationId, orgId))",
  "and(eq(membershipPlans.id, planId), tenantWhere(membershipPlans, ctx))"
);


// getMemberMembershipsService
content = content.replace(
  "export async function getMemberMembershipsService(orgId: string, memberId: string) {",
  "export async function getMemberMembershipsService(ctx: TenantContext, memberId: string) {"
);
content = content.replace(
  "and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt))",
  "and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt))"
);
content = content.replace(
  "eq(memberMemberships.memberId, memberId)",
  "and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx), accessibleBranchesWhere(memberMemberships, ctx))"
);


// getMembershipEventsService
content = content.replace(
  "export async function getMembershipEventsService(orgId: string, memberId: string) {",
  "export async function getMembershipEventsService(ctx: TenantContext, memberId: string) {"
);
content = content.replace(
  "and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt))",
  "and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt))"
);
content = content.replace(
  "eq(membershipEvents.memberId, memberId)",
  "and(eq(membershipEvents.memberId, memberId), tenantWhere(membershipEvents, ctx), accessibleBranchesWhere(membershipEvents, ctx))"
);

// listMembershipEventsService
content = content.replace(
  "export async function listMembershipEventsService(orgId: string, query: Record<string, unknown>) {",
  "export async function listMembershipEventsService(ctx: TenantContext, query: Record<string, unknown>) {"
);
content = content.replace(
  "eq(members.organizationId, orgId)",
  "and(tenantWhere(members, ctx), accessibleBranchesWhere(membershipEvents, ctx))"
);
content = content.replace(
  "eq(members.organizationId, orgId)",
  "and(tenantWhere(members, ctx), accessibleBranchesWhere(membershipEvents, ctx))"
);


// createMembershipService
content = content.replace(
  "export async function createMembershipService(\n  orgId: string,\n  memberId: string,\n  data: {\n    planId: string;\n    startDate: string;\n    notes?: string;\n    idempotencyKey?: string;\n  },\n  actorId: string,\n  actorName?: string,\n) {",
  "export async function createMembershipService(\n  ctx: TenantContext,\n  memberId: string,\n  data: {\n    planId: string;\n    startDate: string;\n    notes?: string;\n    idempotencyKey?: string;\n  },\n  actorName?: string,\n) {"
);
content = content.replace(
  "const plan = await getPlanService(orgId, data.planId);",
  "const plan = await getPlanService(ctx, data.planId);"
);
content = content.replace(
  "      memberId,\n      planId: plan.id,",
  "      organizationId: ctx.organizationId,\n      branchId: ctx.activeBranchId,\n      memberId,\n      planId: plan.id,"
);
content = content.replace(
  "...(actorId ? { createdBy: actorId } : {}),",
  "...({ createdBy: ctx.userId }),"
);
content = content.replace(
  "await emitEvent(membership!.id, memberId, 'CREATED', actorId, actorName, data.notes, { plan: { id: plan.id, name: plan.name, durationDays: plan.durationDays } });",
  "await emitEvent(ctx, membership!.id, memberId, 'CREATED', actorName, data.notes, { plan: { id: plan.id, name: plan.name, durationDays: plan.durationDays } });"
);
content = content.replace(
  "auditLog({\n    organizationId: orgId,\n    actorId,\n    action: AuditAction.MEMBERSHIP_CREATED,",
  "auditLog({\n    organizationId: ctx.organizationId,\n    actorId: ctx.userId,\n    action: AuditAction.MEMBERSHIP_CREATED,"
);

// activateMembershipService
content = content.replace(
  "export async function activateMembershipService(orgId: string, memberId: string, actorId: string, actorName?: string) {",
  "export async function activateMembershipService(ctx: TenantContext, memberId: string, actorName?: string) {"
);
content = content.replace(
  "eq(memberMemberships.memberId, memberId)",
  "and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx))"
);
content = content.replace(
  "await emitEvent(membership.id, memberId, 'ACTIVATED', actorId, actorName);",
  "await emitEvent(ctx, membership.id, memberId, 'ACTIVATED', actorName);"
);
content = content.replace(
  "auditLog({ organizationId: orgId, actorId, action: AuditAction.MEMBERSHIP_ACTIVATED",
  "auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_ACTIVATED"
);
content = content.replace(
  "syncMemberBiometricAccessService(orgId, memberId)",
  "syncMemberBiometricAccessService(ctx.organizationId, memberId)"
);


// renewMembershipService
content = content.replace(
  "export async function renewMembershipService(\n  orgId: string,\n  memberId: string,\n  data: { planId?: string; notes?: string; invoiceAmount?: number; idempotencyKey?: string },\n  actorId: string,\n  actorName?: string,\n) {",
  "export async function renewMembershipService(\n  ctx: TenantContext,\n  memberId: string,\n  data: { planId?: string; notes?: string; invoiceAmount?: number; idempotencyKey?: string },\n  actorName?: string,\n) {"
);
content = content.replace(
  "and(eq(members.id, memberId), eq(members.organizationId, orgId), isNull(members.deletedAt))",
  "and(eq(members.id, memberId), tenantWhere(members, ctx), isNull(members.deletedAt))"
);
content = content.replace(
  "eq(members.organizationId, orgId),",
  "tenantWhere(members, ctx),"
);
content = content.replace(
  "eq(memberMemberships.memberId, memberId)",
  "and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx))"
);
content = content.replace(
  "const plan = await getPlanService(orgId, planId);",
  "const plan = await getPlanService(ctx, planId);"
);
content = content.replace(
  "        memberId,\n        planId: plan.id,",
  "        organizationId: ctx.organizationId,\n        branchId: ctx.activeBranchId,\n        memberId,\n        planId: plan.id,"
);
content = content.replace(
  "...(actorId ? { createdBy: actorId } : {}),",
  "...({ createdBy: ctx.userId }),"
);
content = content.replace(
  "await emitEvent(newMembership!.id, memberId, 'RENEWED', actorId, actorName, data.notes, { plan: { name: plan.name } }, tx);",
  "await emitEvent(ctx, newMembership!.id, memberId, 'RENEWED', actorName, data.notes, { plan: { name: plan.name } }, tx);"
);
content = content.replace(
  "auditLog({ organizationId: orgId, actorId, action: AuditAction.MEMBERSHIP_RENEWED",
  "auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_RENEWED"
);
content = content.replace(
  "syncMemberBiometricAccessService(orgId, memberId)",
  "syncMemberBiometricAccessService(ctx.organizationId, memberId)"
);
content = content.replace(
  "sendRenewalNotification(orgId, memberId, membership!, plan, actorId, data.invoiceAmount)",
  "sendRenewalNotification(ctx, memberId, membership!, plan, data.invoiceAmount)"
);


// freezeMembershipService
content = content.replace(
  "export async function freezeMembershipService(\n  orgId: string,\n  memberId: string,\n  data: { freezeStart: string; freezeEnd: string; reason?: string },\n  actorId: string,\n  actorName?: string,\n) {",
  "export async function freezeMembershipService(\n  ctx: TenantContext,\n  memberId: string,\n  data: { freezeStart: string; freezeEnd: string; reason?: string },\n  actorName?: string,\n) {"
);
content = content.replace(
  "eq(memberMemberships.memberId, memberId)",
  "and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx))"
);
content = content.replace(
  "await emitEvent(membership.id, memberId, 'FROZEN', actorId, actorName, data.reason, { freezeStart: data.freezeStart, freezeEnd: data.freezeEnd, freezeDays }, tx);",
  "await emitEvent(ctx, membership.id, memberId, 'FROZEN', actorName, data.reason, { freezeStart: data.freezeStart, freezeEnd: data.freezeEnd, freezeDays }, tx);"
);
content = content.replace(
  "auditLog({ organizationId: orgId, actorId, action: AuditAction.MEMBERSHIP_FROZEN",
  "auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_FROZEN"
);
content = content.replace(
  "syncMemberBiometricAccessService(orgId, memberId)",
  "syncMemberBiometricAccessService(ctx.organizationId, memberId)"
);


// resumeMembershipService
content = content.replace(
  "export async function resumeMembershipService(orgId: string, memberId: string, actorId: string, actorName?: string) {",
  "export async function resumeMembershipService(ctx: TenantContext, memberId: string, actorName?: string) {"
);
content = content.replace(
  "eq(memberMemberships.memberId, memberId)",
  "and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx))"
);
content = content.replace(
  "await emitEvent(membership.id, memberId, 'RESUMED', actorId, actorName, undefined, undefined, tx);",
  "await emitEvent(ctx, membership.id, memberId, 'RESUMED', actorName, undefined, undefined, tx);"
);
content = content.replace(
  "auditLog({ organizationId: orgId, actorId, action: AuditAction.MEMBERSHIP_RESUMED",
  "auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_RESUMED"
);
content = content.replace(
  "syncMemberBiometricAccessService(orgId, memberId)",
  "syncMemberBiometricAccessService(ctx.organizationId, memberId)"
);


// cancelMembershipService
content = content.replace(
  "export async function cancelMembershipService(orgId: string, memberId: string, reason: string, actorId: string, actorName?: string) {",
  "export async function cancelMembershipService(ctx: TenantContext, memberId: string, reason: string, actorName?: string) {"
);
content = content.replace(
  "eq(memberMemberships.memberId, memberId),",
  "eq(memberMemberships.memberId, memberId),\n      tenantWhere(memberMemberships, ctx),"
);
content = content.replace(
  "await emitEvent(membership.id, memberId, 'CANCELLED', actorId, actorName, reason, undefined, tx);",
  "await emitEvent(ctx, membership.id, memberId, 'CANCELLED', actorName, reason, undefined, tx);"
);
content = content.replace(
  "auditLog({ organizationId: orgId, actorId, action: AuditAction.MEMBERSHIP_CANCELLED",
  "auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_CANCELLED"
);
content = content.replace(
  "syncMemberBiometricAccessService(orgId, memberId)",
  "syncMemberBiometricAccessService(ctx.organizationId, memberId)"
);


// extendMembershipService
content = content.replace(
  "export async function extendMembershipService(orgId: string, memberId: string, days: number, reason: string, actorId: string, actorName?: string) {",
  "export async function extendMembershipService(ctx: TenantContext, memberId: string, days: number, reason: string, actorName?: string) {"
);
content = content.replace(
  "eq(memberMemberships.memberId, memberId)",
  "and(eq(memberMemberships.memberId, memberId), tenantWhere(memberMemberships, ctx))"
);
content = content.replace(
  "await emitEvent(membership.id, memberId, 'EXTENDED', actorId, actorName, reason, { extendedBy: days }, tx);",
  "await emitEvent(ctx, membership.id, memberId, 'EXTENDED', actorName, reason, { extendedBy: days }, tx);"
);
content = content.replace(
  "auditLog({ organizationId: orgId, actorId, action: AuditAction.MEMBERSHIP_EXTENDED",
  "auditLog({ organizationId: ctx.organizationId, actorId: ctx.userId, action: AuditAction.MEMBERSHIP_EXTENDED"
);
content = content.replace(
  "syncMemberBiometricAccessService(orgId, memberId)",
  "syncMemberBiometricAccessService(ctx.organizationId, memberId)"
);


fs.writeFileSync('src/modules/memberships/memberships.service.ts', content);
console.log('Done refactoring memberships.service.ts');
