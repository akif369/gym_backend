const fs = require('fs');

// 1. biometrics.controller.ts
let controller = fs.readFileSync('src/modules/biometrics/biometrics.controller.ts', 'utf8');
controller = controller.replace(/request\.user/g, 'req.user');
fs.writeFileSync('src/modules/biometrics/biometrics.controller.ts', controller);

// 2. biometrics.service.ts
let bioService = fs.readFileSync('src/modules/biometrics/biometrics.service.ts', 'utf8');
bioService = bioService.replace(
  /export async function syncMemberToBiometricsService\(\s*orgId:\s*string,/g,
  "export async function syncMemberToBiometricsService(\n  ctx: TenantContext,"
);
fs.writeFileSync('src/modules/biometrics/biometrics.service.ts', bioService);

// 3. members.service.ts
let memService = fs.readFileSync('src/modules/members/members.service.ts', 'utf8');
memService = memService.replace(/syncMemberBiometricAccessService\(ctx\.organizationId,/g, "syncMemberBiometricAccessService(ctx,");
memService = memService.replace(/syncMemberBiometricAccessService\(orgId,/g, "syncMemberBiometricAccessService(ctx,");
fs.writeFileSync('src/modules/members/members.service.ts', memService);

// 4. memberships.service.ts
let membershipsService = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');
membershipsService = membershipsService.replace(/syncMemberBiometricAccessService\(ctx\.organizationId,/g, "syncMemberBiometricAccessService(ctx,");
fs.writeFileSync('src/modules/memberships/memberships.service.ts', membershipsService);

// 5. test-biometrics.ts
let test = fs.readFileSync('src/scripts/test-biometrics.ts', 'utf8');
test = test.replace(/syncMemberBiometricAccessService\(orgId,/g, "syncMemberBiometricAccessService(ctx,");
test = test.replace(/calculateMemberAccessGroup\(orgId,/g, "calculateMemberAccessGroup(ctx,");
fs.writeFileSync('src/scripts/test-biometrics.ts', test);

console.log('Fixed everything');
