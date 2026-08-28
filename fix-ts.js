const fs = require('fs');

function fixMembersService() {
  let s = fs.readFileSync('src/modules/members/members.service.ts', 'utf8');
  s = s.replace(/sendTextInput\({\s*organizationId:\s*ctx/g, "sendTextInput({ ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx/g, "sendTextMessage({ ctx");
  // Some places might pass a string to getMemberService... wait, the error is:
  // Argument of type 'string' is not assignable to parameter of type 'TenantContext'.
  // We need to pass ctx instead of string.
  s = s.replace(/getMemberService\([^,]*?orgId/g, "getMemberService(ctx");
  s = s.replace(/getMemberService\([^,]*?ctx\.organizationId/g, "getMemberService(ctx");
  s = s.replace(/listMembershipsForMemberService\([^,]*?ctx\.organizationId/g, "listMembershipsForMemberService(ctx");
  fs.writeFileSync('src/modules/members/members.service.ts', s);
}

function fixMembershipsService() {
  let s = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');
  // Duplicate TenantContext imports
  s = s.replace("import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';", "import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';");

  // Fix string passed as TenantContext
  s = s.replace(/getMemberService\([^,]*?candidate\.organizationId/g, "getMemberService(systemCtx");
  s = s.replace(/getMembershipPlanService\([^,]*?candidate\.organizationId/g, "getMembershipPlanService(systemCtx");
  s = s.replace(/getMembershipService\([^,]*?candidate\.organizationId/g, "getMembershipService(systemCtx");
  s = s.replace(/getMemberService\([^,]*?ctx\.organizationId/g, "getMemberService(ctx");
  s = s.replace(/getMembershipService\([^,]*?ctx\.organizationId/g, "getMembershipService(ctx");
  s = s.replace(/addMembershipToMemberService\([^,]*?candidate\.organizationId/g, "addMembershipToMemberService(systemCtx");

  // Fix object literals 'ctx'
  s = s.replace(/sendMediaMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendMediaMessage({\n        ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n        ctx");
  s = s.replace(/sendMediaMessage\({\s*organizationId:\s*systemCtx\.organizationId/g, "sendMediaMessage({\n        ctx: systemCtx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*systemCtx\.organizationId/g, "sendTextMessage({\n        ctx: systemCtx");

  fs.writeFileSync('src/modules/memberships/memberships.service.ts', s);
}

function fixPaymentsController() {
  let s = fs.readFileSync('src/modules/payments/payments.controller.ts', 'utf8');
  s = s.replace(/req\.user\.orgId/g, "req.user");
  s = s.replace(/request\.user\.orgId/g, "request.user");
  fs.writeFileSync('src/modules/payments/payments.controller.ts', s);
}

function fixPaymentsService() {
  let s = fs.readFileSync('src/modules/payments/payments.service.ts', 'utf8');
  
  // replace undefined ctx with orgId ... wait, we need to pass ctx to payments!
  s = s.replace(/export async function (.*?)\(orgId: string,/g, "export async function $1(ctx: TenantContext,");
  s = s.replace(/eq\(invoices\.organizationId, orgId\)/g, "tenantWhere(invoices, ctx), accessibleBranchesWhere(invoices, ctx)");
  s = s.replace(/eq\(paymentTransactions\.organizationId, orgId\)/g, "tenantWhere(paymentTransactions, ctx), accessibleBranchesWhere(paymentTransactions, ctx)");
  s = s.replace(/eq\(refunds\.organizationId, orgId\)/g, "tenantWhere(refunds, ctx), accessibleBranchesWhere(refunds, ctx)");
  
  // getInvoiceSettingsService(ctx.organizationId) -> getInvoiceSettingsService(ctx)
  s = s.replace(/getInvoiceSettingsService\([^,]*?orgId\)/g, "getInvoiceSettingsService(ctx.organizationId)");
  s = s.replace(/getTaxSettingsService\([^,]*?orgId\)/g, "getTaxSettingsService(ctx.organizationId)");

  s = s.replace(/organizationId:\s*orgId/g, "organizationId: ctx.organizationId");
  s = s.replace(/organizationId: ctx.organizationId, branchId: ctx.activeBranchId/g, "organizationId: ctx.organizationId");
  
  // auditLog -> uses ctx.organizationId
  // sendTextMessage -> uses ctx
  s = s.replace(/sendMediaMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendMediaMessage({\n        ctx: ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n        ctx: ctx");
  s = s.replace(/sendMediaMessage\({\s*organizationId:\s*orgId/g, "sendMediaMessage({\n        ctx: ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*orgId/g, "sendTextMessage({\n        ctx: ctx");
  
  fs.writeFileSync('src/modules/payments/payments.service.ts', s);
}

function fixStaffService() {
  let s = fs.readFileSync('src/modules/staff/staff.service.ts', 'utf8');
  s = s.replace(/ctx: ctx\.organizationId/g, "organizationId: ctx.organizationId");
  s = s.replace(/ctx,/g, "organizationId: ctx.organizationId, branchId: ctx.activeBranchId,");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n        ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId: ctx\.organizationId, branchId: ctx\.activeBranchId,/g, "sendTextMessage({\n        ctx,");
  fs.writeFileSync('src/modules/staff/staff.service.ts', s);
}

fixMembersService();
fixMembershipsService();
fixPaymentsController();
fixPaymentsService();
fixStaffService();
console.log('Fixed TS errors');
