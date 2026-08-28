const fs = require('fs');

let s = fs.readFileSync('src/modules/leads/leads.service.ts', 'utf8');

// 1. Imports
if (!s.includes('tenantWhere')) {
  s = s.replace(
    "import { db } from '../../db/index';",
    "import { db } from '../../db/index';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';"
  );
}

// 2. listLeadsService
s = s.replace(/export async function listLeadsService\(orgId: string,/g, "export async function listLeadsService(ctx: TenantContext,");
s = s.replace(/eq\(leads\.organizationId, orgId\)/g, "tenantWhere(leads, ctx), accessibleBranchesWhere(leads, ctx)");

// 3. createLeadService
s = s.replace(/export async function createLeadService\(orgId: string,/g, "export async function createLeadService(ctx: TenantContext,");
s = s.replace(
  "organizationId: orgId, createdBy: actorId",
  "organizationId: ctx.organizationId, branchId: data.branchId || ctx.activeBranchId, createdBy: actorId"
);
s = s.replace(
  "organizationId: orgId, actorId, action: AuditAction.LEAD_CREATED",
  "organizationId: ctx.organizationId, branchId: ctx.activeBranchId, actorId, action: AuditAction.LEAD_CREATED"
);

// 4. getLeadService
s = s.replace(/export async function getLeadService\(orgId: string,/g, "export async function getLeadService(ctx: TenantContext,");
s = s.replace(/eq\(leads\.organizationId, orgId\)/g, "tenantWhere(leads, ctx), accessibleBranchesWhere(leads, ctx)");

// 5. updateLeadService
s = s.replace(/export async function updateLeadService\(orgId: string,/g, "export async function updateLeadService(ctx: TenantContext,");
s = s.replace(/getLeadService\(orgId,/g, "getLeadService(ctx,");

// 6. updateLeadStatusService
s = s.replace(/export async function updateLeadStatusService\(orgId: string,/g, "export async function updateLeadStatusService(ctx: TenantContext,");
s = s.replace(
  "organizationId: orgId, actorId, action: AuditAction.LEAD_STATUS_CHANGED",
  "organizationId: ctx.organizationId, branchId: ctx.activeBranchId, actorId, action: AuditAction.LEAD_STATUS_CHANGED"
);

// 7. addLeadActivityService
s = s.replace(/export async function addLeadActivityService\(orgId: string,/g, "export async function addLeadActivityService(ctx: TenantContext,");
s = s.replace(
  "values({ ...data, leadId, actorId })",
  "values({ ...data, organizationId: ctx.organizationId, branchId: ctx.activeBranchId, leadId, actorId })"
);

// 8. convertLeadService
s = s.replace(/export async function convertLeadService\(orgId: string,/g, "export async function convertLeadService(ctx: TenantContext,");
s = s.replace(
  "organizationId: orgId, actorId, action: AuditAction.LEAD_CONVERTED",
  "organizationId: ctx.organizationId, branchId: ctx.activeBranchId, actorId, action: AuditAction.LEAD_CONVERTED"
);

// 9. Analytics
s = s.replace(/export async function getLeadSourcesAnalyticsService\(orgId: string\)/g, "export async function getLeadSourcesAnalyticsService(ctx: TenantContext)");
s = s.replace(/export async function getLeadPipelineAnalyticsService\(orgId: string\)/g, "export async function getLeadPipelineAnalyticsService(ctx: TenantContext)");

fs.writeFileSync('src/modules/leads/leads.service.ts', s);

let c = fs.readFileSync('src/modules/leads/leads.controller.ts', 'utf8');
c = c.replace(/req\.user\.orgId/g, 'req.user');
fs.writeFileSync('src/modules/leads/leads.controller.ts', c);

console.log('Fixed leads');
