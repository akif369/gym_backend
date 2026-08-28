const fs = require('fs');

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
console.log('Fixed test script');
