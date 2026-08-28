const fs = require('fs');

let s = fs.readFileSync('src/modules/leads/leads.service.ts', 'utf8');

if (!s.includes('tenantWhere')) {
  s = s.replace(
    "import { db } from '../../db/index';",
    "import { db } from '../../db/index';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';"
  );
}

s = s.replace(/export async function (.*?)\(orgId: string,/g, "export async function $1(ctx: TenantContext,");

// Fix db queries
s = s.replace(/eq\(leads\.organizationId, orgId\)/g, "tenantWhere(leads, ctx), accessibleBranchesWhere(leads, ctx)");

// Fix inserts
s = s.replace(
  "organizationId: orgId, createdBy: actorId",
  "organizationId: ctx.organizationId, branchId: data.branchId || ctx.activeBranchId, createdBy: actorId"
);

s = s.replace(
  "organizationId: orgId, actorId,",
  "organizationId: ctx.organizationId, branchId: ctx.activeBranchId, actorId,"
);

s = s.replace(/getLeadService\(orgId,/g, "getLeadService(ctx,");

s = s.replace(
  "values({ ...data, leadId, actorId })",
  "values({ ...data, organizationId: ctx.organizationId, branchId: ctx.activeBranchId, leadId, actorId })"
);

fs.writeFileSync('src/modules/leads/leads.service.ts', s);

let c = fs.readFileSync('src/modules/leads/leads.controller.ts', 'utf8');
c = c.replace(/req\.user\.orgId/g, 'req.user');
fs.writeFileSync('src/modules/leads/leads.controller.ts', c);

console.log('Fixed leads smart');
