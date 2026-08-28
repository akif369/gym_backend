const fs = require('fs');

// 1. trainers.controller.ts
let tController = fs.readFileSync('src/modules/trainers/trainers.controller.ts', 'utf8');
tController = tController.replace(/request\.user\.orgId/g, 'request.user');
tController = tController.replace(/req\.user\.orgId/g, 'req.user');
fs.writeFileSync('src/modules/trainers/trainers.controller.ts', tController);

// 2. seed.ts
let seed = fs.readFileSync('src/db/seeds/seed.ts', 'utf8');
// It inserts into trainerAssignments with { trainerId: ..., memberId: ..., assignedBy: ... }
seed = seed.replace(
  /trainerId: /g,
  "organizationId: org.id, branchId: branchesData[0].id, trainerId: "
);
fs.writeFileSync('src/db/seeds/seed.ts', seed);

console.log('Fixed trainers errors');
