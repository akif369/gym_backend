const fs = require('fs');

let service = fs.readFileSync('src/modules/biometrics/biometrics.service.ts', 'utf8');

// 1. syncMemberToBiometricsService signature
service = service.replace(
  "export async function syncMemberToBiometricsService(\n  orgId: string,\n  branchId: string,\n  memberId: string,\n  pin: string,\n  name: string,\n  accessGroup?: number\n) {",
  "export async function syncMemberToBiometricsService(\n  ctx: TenantContext,\n  branchId: string,\n  memberId: string,\n  pin: string,\n  name: string,\n  accessGroup?: number\n) {"
);

fs.writeFileSync('src/modules/biometrics/biometrics.service.ts', service);

console.log('Fixed biometrics.service.ts');
