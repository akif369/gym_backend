const fs = require('fs');

// 1. members.service.ts
let memService = fs.readFileSync('src/modules/members/members.service.ts', 'utf8');
memService = memService.replace(/deleteBiometricIdentityService\(ctx\.organizationId,/g, "deleteBiometricIdentityService(ctx,");
fs.writeFileSync('src/modules/members/members.service.ts', memService);

// 2. memberships.service.ts
let membershipsService = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');
// For any biometrics function that takes ctx, if it's currently ctx.organizationId, fix it.
membershipsService = membershipsService.replace(/syncMemberBiometricAccessService\(ctx\.organizationId,/g, "syncMemberBiometricAccessService(ctx,");
membershipsService = membershipsService.replace(/calculateMemberAccessGroup\(ctx\.organizationId,/g, "calculateMemberAccessGroup(ctx,");
fs.writeFileSync('src/modules/memberships/memberships.service.ts', membershipsService);

// 3. test-biometrics.ts
let test = fs.readFileSync('src/scripts/test-biometrics.ts', 'utf8');
test = test.replace(/calculateMemberAccessGroup\(orgId,/g, "calculateMemberAccessGroup(ctx,");
test = test.replace(/syncMemberBiometricAccessService\(orgId,/g, "syncMemberBiometricAccessService(ctx,");

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

console.log('Fixed ctx passing');
