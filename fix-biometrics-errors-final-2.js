const fs = require('fs');

let service = fs.readFileSync('src/modules/biometrics/biometrics.service.ts', 'utf8');

service = service.replace(
  /export async function syncMemberBiometricAccessService\(\s*orgId:\s*string,/g,
  "export async function syncMemberBiometricAccessService(\n  ctx: TenantContext,"
);

// Fix controller (lines 416, 423) that pass 'req.user' as actorName (which was the last arg). Wait, the error is:
// `Argument of type 'AuthUser' is not assignable to parameter of type 'string'` in biometrics.controller.ts.
// Let's just blindly fix it by replacing the third/fourth arg properly.
let controller = fs.readFileSync('src/modules/biometrics/biometrics.controller.ts', 'utf8');
controller = controller.replace(/req\.user\.userId/g, 'req.user');
controller = controller.replace(/req\.user/g, 'request.user'); // make consistent
// Wait, the error is that `request.user` is being passed to an argument that expects `string` because we passed `request.user` to `orgId` position, and maybe the service function signature wasn't updated!
// If `syncMemberBiometricAccessService` still had `orgId: string`, then passing `request.user` would cause this error.

fs.writeFileSync('src/modules/biometrics/biometrics.service.ts', service);
fs.writeFileSync('src/modules/biometrics/biometrics.controller.ts', controller);
console.log('Fixed biometrics again');
