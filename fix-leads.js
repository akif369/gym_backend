const fs = require('fs');

let s = fs.readFileSync('src/modules/leads/leads.service.ts', 'utf8');

if (!s.includes('tenantWhere')) {
  s = s.replace(
    "import { db } from '../../db/index';",
    "import { db } from '../../db/index';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';"
  );
}

s = s.replace(/export async function (.*?)\(orgId: string,/g, "export async function $1(ctx: TenantContext,");
s = s.replace(/eq\(leads\.organizationId, orgId\)/g, "tenantWhere(leads, ctx), accessibleBranchesWhere(leads, ctx)");
s = s.replace(/organizationId: orgId,/g, "organizationId: ctx.organizationId, branchId: data.branchId || ctx.activeBranchId,");
s = s.replace(/organizationId: orgId/g, "organizationId: ctx.organizationId");
s = s.replace(/getLeadService\(orgId,/g, "getLeadService(ctx,");

// For insert into leadActivities:
// trainerId: ..., memberId: ... -> wait this is lead activities, not trainers.
// { leadId, activityType: 'NOTE', notes: `Lead updated...
s = s.replace(
  "{ leadId, activityType: 'NOTE'",
  "{ organizationId: ctx.organizationId, branchId: ctx.activeBranchId, leadId, activityType: 'NOTE'"
);

fs.writeFileSync('src/modules/leads/leads.service.ts', s);

let c = fs.readFileSync('src/modules/leads/leads.controller.ts', 'utf8');
c = c.replace(/request\.user\.orgId/g, 'request.user');
c = c.replace(/req\.user\.orgId/g, 'req.user');
fs.writeFileSync('src/modules/leads/leads.controller.ts', c);

console.log('Fixed leads');
