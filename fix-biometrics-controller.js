const fs = require('fs');

let controller = fs.readFileSync('src/modules/biometrics/biometrics.controller.ts', 'utf8');
controller = controller.replace(/request\.user\.orgId/g, 'request.user');
fs.writeFileSync('src/modules/biometrics/biometrics.controller.ts', controller);

console.log('Fixed biometrics controller');
