const fs = require('fs');

let content = fs.readFileSync('src/modules/memberships/memberships.controller.ts', 'utf8');

// Replace request.user.orgId with request.user
content = content.replace(/request\.user\.orgId/g, 'request.user');

// Remove request.user.userId from function calls (actorId argument was removed from services)
content = content.replace(/,\s*request\.user\.userId,\s*`\$\{request\.user\.role\}`/g, '');
content = content.replace(/,\s*request\.user\.userId/g, '');

fs.writeFileSync('src/modules/memberships/memberships.controller.ts', content);
console.log('Done refactoring memberships.controller.ts');
