const fs = require('fs');

let service = fs.readFileSync('src/modules/dashboard/dashboard.service.ts', 'utf8');

if (!service.includes('tenantWhere')) {
  service = service.replace(
    "import { toISTDateString",
    "import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';\nimport { toISTDateString"
  );
}

service = service.replace(
  "export async function getDashboardService(orgId: string, branchId?: string) {",
  "export async function getDashboardService(ctx: TenantContext) {"
);

// We replace orgFilter with tenantWhere(table, ctx) and accessibleBranchesWhere(table, ctx)
// But we need to make sure we don't break the existing code which does `and(orgFilter(attendanceLogs), ...)`
service = service.replace(
  "const orgFilter = (table: any) => branchId ? and(eq(table.organizationId, orgId), eq(table.branchId, branchId)) : eq(table.organizationId, orgId);",
  "const orgFilter = (table: any) => and(tenantWhere(table, ctx), accessibleBranchesWhere(table, ctx));"
);

fs.writeFileSync('src/modules/dashboard/dashboard.service.ts', service);

let controller = fs.readFileSync('src/modules/dashboard/dashboard.controller.ts', 'utf8');
controller = controller.replace(/request\.user\.orgId,\s*query\.branchId/g, 'request.user');
fs.writeFileSync('src/modules/dashboard/dashboard.controller.ts', controller);

console.log('Fixed dashboard');
