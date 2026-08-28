const fs = require('fs');

// 1. biometrics.controller.ts
let controller = fs.readFileSync('src/modules/biometrics/biometrics.controller.ts', 'utf8');
controller = controller.replace(/req\.user\.orgId/g, 'req.user');
controller = controller.replace(/request\.user\.orgId/g, 'request.user');
fs.writeFileSync('src/modules/biometrics/biometrics.controller.ts', controller);

// 2. biometrics.service.ts
let service = fs.readFileSync('src/modules/biometrics/biometrics.service.ts', 'utf8');
service = service.replace(/eq\(members\.organizationId, orgId\)/g, "eq(members.organizationId, ctx.organizationId)");
service = service.replace(/eq\(biometricDevices\.organizationId, orgId\)/g, "eq(biometricDevices.organizationId, ctx.organizationId)");
service = service.replace(/organizationId: orgId/g, "organizationId: ctx.organizationId");
service = service.replace(/calculateMemberAccessGroup\(orgId, /g, "calculateMemberAccessGroup(ctx, ");
service = service.replace(/syncMemberBiometricAccessService\(orgId, /g, "syncMemberBiometricAccessService(ctx, ");
fs.writeFileSync('src/modules/biometrics/biometrics.service.ts', service);

// 3. members.service.ts
let memService = fs.readFileSync('src/modules/members/members.service.ts', 'utf8');
// Error in members.service.ts at 543 and 567 calling syncMemberBiometricAccessService(orgId, memberId)
memService = memService.replace(/syncMemberBiometricAccessService\(orgId, /g, "syncMemberBiometricAccessService(ctx, ");
fs.writeFileSync('src/modules/members/members.service.ts', memService);

// 4. test-biometrics.ts
let test = fs.readFileSync('src/scripts/test-biometrics.ts', 'utf8');
test = test.replace(/calculateMemberAccessGroup\(orgId,/g, "calculateMemberAccessGroup(ctx,");
test = test.replace(/syncMemberBiometricAccessService\(orgId,/g, "syncMemberBiometricAccessService(ctx,");
// Needs `ctx` defined in test script
if (!test.includes("const ctx: TenantContext = {")) {
  test = test.replace(
    "const orgId = org!.id;",
    "const orgId = org!.id;\n  const ctx: TenantContext = {\n    organizationId: orgId,\n    activeBranchId: null,\n    accessibleBranchIds: [],\n    userId: 'SYSTEM',\n    role: 'SUPER_ADMIN',\n    permissions: [],\n    organizationMode: 'SINGLE_GYM'\n  };"
  );
  test = test.replace(
    "import { biometricDevices }",
    "import { TenantContext } from '../common/auth/tenant';\nimport { biometricDevices }"
  );
}
fs.writeFileSync('src/scripts/test-biometrics.ts', test);

console.log('Fixed remaining biometrics errors');
