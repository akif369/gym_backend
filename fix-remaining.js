const fs = require('fs');

// Fix controller
let controllerContent = fs.readFileSync('src/modules/memberships/memberships.controller.ts', 'utf8');
controllerContent = controllerContent.replace(/request\.user\.orgId/g, 'request.user');
controllerContent = controllerContent.replace(/,\s*request\.user\.userId,\s*`\$\{request\.user\.role\}`/g, '');
controllerContent = controllerContent.replace(/,\s*request\.user\.userId/g, '');
fs.writeFileSync('src/modules/memberships/memberships.controller.ts', controllerContent);

// Fix test-biometrics.ts
let testContent = fs.readFileSync('src/scripts/test-biometrics.ts', 'utf8');
testContent = testContent.replace(
  "    name: 'Annual Pass',",
  "    branchId: branch!.id,\n    name: 'Annual Pass',"
);
testContent = testContent.replace(
  "    memberId: member!.id,",
  "    organizationId: org!.id,\n    branchId: branch!.id,\n    memberId: member!.id,"
);
fs.writeFileSync('src/scripts/test-biometrics.ts', testContent);

console.log('Fixed remaining files');
