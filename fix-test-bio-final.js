const fs = require('fs');

let test = fs.readFileSync('src/scripts/test-biometrics.ts', 'utf8');
test = test.replace(/org!\.id/g, "ctx as any");
test = test.replace(/calculateMemberAccessGroup\(ctx as any,/g, "calculateMemberAccessGroup(ctx,");
test = test.replace(/syncMemberBiometricAccessService\(ctx as any,/g, "syncMemberBiometricAccessService(ctx,");

test = test.replace(/organizationId: ctx as any,/g, "organizationId: org!.id,");
fs.writeFileSync('src/scripts/test-biometrics.ts', test);
console.log('Fixed test biometrics finally');
