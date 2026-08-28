const fs = require('fs');

let test = fs.readFileSync('src/scripts/test-biometrics.ts', 'utf8');

// Define a valid ctx at the top
test = test.replace(
  "  const adminUser = {",
  "  const ctx: any = { organizationId: org!.id, activeBranchId: branch!.id, userId: 'SYSTEM', role: 'ADMIN' };\n  const adminUser = {"
);

// Replace function calls
test = test.replace(/syncMemberBiometricAccessService\(org!\.id,/g, "syncMemberBiometricAccessService(ctx,");
test = test.replace(/calculateMemberAccessGroup\(org!\.id,/g, "calculateMemberAccessGroup(ctx,");

// Add branchId
if (!test.includes("branchId: branch!.id,")) {
  test = test.replace(
    "    name: 'Annual Pass',",
    "    branchId: branch!.id,\n    name: 'Annual Pass',"
  );
  test = test.replace(
    "    memberId: member!.id,",
    "    organizationId: org!.id,\n    branchId: branch!.id,\n    memberId: member!.id,"
  );
}

fs.writeFileSync('src/scripts/test-biometrics.ts', test);
console.log('Fixed test biometrics!');
