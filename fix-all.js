const fs = require('fs');

function fixMembersService() {
  let s = fs.readFileSync('src/modules/members/members.service.ts', 'utf8');
  s = s.replace(/organizationId:\s*orgId/g, "ctx");
  s = s.replace(/organizationId:\s*ctx\.organizationId/g, "ctx");
  s = s.replace(/getMemberService\(orgId/g, "getMemberService(ctx");
  s = s.replace(/listMembershipsForMemberService\(orgId/g, "listMembershipsForMemberService(ctx");
  fs.writeFileSync('src/modules/members/members.service.ts', s);
}

function fixMembershipsService() {
  let s = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');
  // Remove duplicates
  s = s.replace("import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';", "import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';");
  
  s = s.replace(/organizationId:\s*candidate\.organizationId/g, "ctx: systemCtx");
  s = s.replace(/organizationId:\s*orgId/g, "ctx");
  s = s.replace(/organizationId:\s*ctx\.organizationId/g, "ctx");
  
  s = s.replace(/getMemberService\(orgId/g, "getMemberService(ctx");
  s = s.replace(/getMembershipService\(orgId/g, "getMembershipService(ctx");
  s = s.replace(/getMembershipPlanService\(orgId/g, "getMembershipPlanService(ctx");
  s = s.replace(/addMembershipToMemberService\(orgId/g, "addMembershipToMemberService(ctx");
  
  s = s.replace(/getMemberService\(ctx\.organizationId/g, "getMemberService(ctx");
  
  fs.writeFileSync('src/modules/memberships/memberships.service.ts', s);
}

function fixPaymentsService() {
  let s = fs.readFileSync('src/modules/payments/payments.service.ts', 'utf8');
  // It seems payments wasn't refactored well.
  s = s.replace(/export async function (.*?)\(orgId: string,/g, "export async function $1(ctx: TenantContext,");
  s = s.replace(/eq\(invoices\.organizationId, orgId\)/g, "tenantWhere(invoices, ctx), accessibleBranchesWhere(invoices, ctx)");
  s = s.replace(/eq\(paymentTransactions\.organizationId, orgId\)/g, "tenantWhere(paymentTransactions, ctx), accessibleBranchesWhere(paymentTransactions, ctx)");
  s = s.replace(/eq\(refunds\.organizationId, orgId\)/g, "tenantWhere(refunds, ctx), accessibleBranchesWhere(refunds, ctx)");
  
  s = s.replace(/organizationId:\s*orgId/g, "organizationId: ctx.organizationId, branchId: ctx.activeBranchId");
  
  // auditLogs might need fixing if they have orgId: orgId
  
  fs.writeFileSync('src/modules/payments/payments.service.ts', s);
}

function fixStaffService() {
  let s = fs.readFileSync('src/modules/staff/staff.service.ts', 'utf8');
  s = s.replace(/organizationId:\s*orgId/g, "ctx");
  fs.writeFileSync('src/modules/staff/staff.service.ts', s);
}

fixMembersService();
fixMembershipsService();
fixPaymentsService();
fixStaffService();
console.log('Fixed services');
