const fs = require('fs');

function fixStaffService() {
  let s = fs.readFileSync('src/modules/staff/staff.service.ts', 'utf8');
  
  // Fix duplicate branchId in inserts
  s = s.replace(/organizationId: ctx\.organizationId, branchId: ctx\.activeBranchId,\n\s*branchId/g, "organizationId: ctx.organizationId,\n      branchId");
  s = s.replace(/organizationId: ctx\.organizationId, branchId: ctx\.activeBranchId,/g, "organizationId: ctx.organizationId,");
  
  // Fix sendTextMessage actorId missing in some cases if any? 
  // No, the error is: Object literal may only specify known properties, and 'organizationId' does not exist in type 'SendTextInput'.
  // We replaced `ctx,` with `organizationId: ctx.organizationId, branchId: ctx.activeBranchId,`.
  // Wait, I replaced `ctx,` which was correct for `sendTextMessage`!
  // I need to put `ctx,` back into `sendTextMessage({ ctx, ... })`.
  s = s.replace(/sendTextMessage\({\n\s*organizationId: ctx\.organizationId,\n/g, "sendTextMessage({\n        ctx,\n");
  s = s.replace(/sendTextMessage\({\n\s*organizationId: ctx\.organizationId\n/g, "sendTextMessage({\n        ctx\n");

  fs.writeFileSync('src/modules/staff/staff.service.ts', s);
}

function fixPaymentsService() {
  let s = fs.readFileSync('src/modules/payments/payments.service.ts', 'utf8');
  
  // Fix tenantWhere(paymentTransactions, ctx) replacing orgId
  // The error says "Cannot find name 'ctx'" in many places.
  // Because my `export async function ...` regex failed to match multiline or something!
  s = s.replace(/export async function (.*?)\(orgId: string,/g, "export async function $1(ctx: TenantContext,");
  // Some functions might have `(orgId: string)` without a trailing comma:
  s = s.replace(/export async function (.*?)\(orgId: string\)/g, "export async function $1(ctx: TenantContext)");
  
  // Fix missing actorId in sendTextMessage
  // "No value exists in scope for the shorthand property 'actorId'"
  s = s.replace(/sendTextMessage\({\n\s*ctx: ctx,\n\s*eventType/g, "sendTextMessage({\n        ctx,\n        actorId: undefined,\n        eventType");
  s = s.replace(/sendMediaMessage\({\n\s*ctx: ctx,\n\s*eventType/g, "sendMediaMessage({\n        ctx,\n        actorId: undefined,\n        eventType");
  s = s.replace(/sendTextMessage\({\n\s*ctx: ctx,/g, "sendTextMessage({\n        ctx,");
  s = s.replace(/sendMediaMessage\({\n\s*ctx: ctx,/g, "sendMediaMessage({\n        ctx,");

  fs.writeFileSync('src/modules/payments/payments.service.ts', s);
}

function fixPaymentsController() {
  let s = fs.readFileSync('src/modules/payments/payments.controller.ts', 'utf8');
  s = s.replace(/req\.user\.orgId/g, "req.user");
  s = s.replace(/request\.user\.orgId/g, "request.user");
  fs.writeFileSync('src/modules/payments/payments.controller.ts', s);
}

function fixMembershipsService() {
  let s = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');
  
  // Cannot find name 'systemCtx'
  s = s.replace(/systemCtx/g, "ctx"); 
  // Wait, I replaced `candidate.organizationId` with `systemCtx`. But `systemCtx` wasn't defined in the loop!
  // It should be `ctx: { organizationId: candidate.organizationId, branchId: candidate.branchId, userId: 'SYSTEM', role: 'ADMIN', permissions: [], activeBranchId: null } as unknown as TenantContext`
  s = s.replace(/ctx: ctx/g, "ctx: { organizationId: candidate.organizationId, userId: 'SYSTEM', role: 'ADMIN' } as unknown as TenantContext");
  
  // AuditLogParams ctx
  s = s.replace(/auditLog\(\{[\s\n]*ctx: \{ organizationId: candidate\.organizationId.*?\},/g, "auditLog({\n        organizationId: candidate.organizationId,");
  s = s.replace(/auditLog\(\{[\s\n]*ctx,/g, "auditLog({\n        organizationId: ctx.organizationId,");
  
  fs.writeFileSync('src/modules/memberships/memberships.service.ts', s);
}

fixStaffService();
fixPaymentsService();
fixPaymentsController();
fixMembershipsService();
console.log('Fixed TS errors 2');
