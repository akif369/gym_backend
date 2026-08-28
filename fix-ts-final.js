const fs = require('fs');

function fixMembersService() {
  let s = fs.readFileSync('src/modules/members/members.service.ts', 'utf8');
  s = s.replace(/sendTextMessage\({\s*\n\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  s = s.replace(/getMemberService\(orgId,/g, "getMemberService(ctx,");
  s = s.replace(/listMembershipsForMemberService\(orgId,/g, "listMembershipsForMemberService(ctx,");
  s = s.replace(/getMemberService\(ctx\.organizationId,/g, "getMemberService(ctx,");
  s = s.replace(/listMembershipsForMemberService\(ctx\.organizationId,/g, "listMembershipsForMemberService(ctx,");
  fs.writeFileSync('src/modules/members/members.service.ts', s);
}

function fixMembershipsService() {
  let s = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');
  s = s.replace(/sendMediaMessage\({\s*\n\s*organizationId:\s*ctx\.organizationId/g, "sendMediaMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*\n\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  s = s.replace(/sendMediaMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendMediaMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  
  s = s.replace(/sendTextMessage\({\s*\n\s*organizationId:\s*systemCtx\.organizationId/g, "sendTextMessage({\n      ctx: systemCtx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*systemCtx\.organizationId/g, "sendTextMessage({\n      ctx: systemCtx");
  
  s = s.replace(/getMemberService\(orgId,/g, "getMemberService(ctx,");
  s = s.replace(/getMemberService\(ctx\.organizationId,/g, "getMemberService(ctx,");
  s = s.replace(/getMembershipPlanService\(orgId,/g, "getMembershipPlanService(ctx,");
  s = s.replace(/getMembershipPlanService\(ctx\.organizationId,/g, "getMembershipPlanService(ctx,");
  
  s = s.replace(/getMemberService\(candidate\.organizationId,/g, "getMemberService(systemCtx,");
  s = s.replace(/addMembershipToMemberService\(candidate\.organizationId,/g, "addMembershipToMemberService(systemCtx,");
  
  s = s.replace(/getMembershipService\(ctx\.organizationId,/g, "getMembershipService(ctx,");
  s = s.replace(/getMembershipService\(candidate\.organizationId,/g, "getMembershipService(systemCtx,");
  fs.writeFileSync('src/modules/memberships/memberships.service.ts', s);
}

function fixPaymentsService() {
  let s = fs.readFileSync('src/modules/payments/payments.service.ts', 'utf8');
  s = s.replace(/sendMediaMessage\({\s*\n\s*organizationId:\s*ctx\.organizationId/g, "sendMediaMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*\n\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  s = s.replace(/sendMediaMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendMediaMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  
  s = s.replace(/sendMediaMessage\({\s*\n\s*organizationId:\s*orgId/g, "sendMediaMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*\n\s*organizationId:\s*orgId/g, "sendTextMessage({\n      ctx");
  s = s.replace(/sendMediaMessage\({\s*organizationId:\s*orgId/g, "sendMediaMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*orgId/g, "sendTextMessage({\n      ctx");
  fs.writeFileSync('src/modules/payments/payments.service.ts', s);
}

function fixStaffService() {
  let s = fs.readFileSync('src/modules/staff/staff.service.ts', 'utf8');
  s = s.replace(/sendTextMessage\({\s*\n\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  s = s.replace(/sendTextMessage\({\s*organizationId:\s*ctx\.organizationId/g, "sendTextMessage({\n      ctx");
  fs.writeFileSync('src/modules/staff/staff.service.ts', s);
}

fixMembersService();
fixMembershipsService();
fixPaymentsService();
fixStaffService();
console.log('Fixed final TS errors');
