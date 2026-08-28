const fs = require('fs');

function replaceFile(path, replaces) {
  let content = fs.readFileSync(path, 'utf8');
  for (const [from, to] of replaces) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(path, content);
}

// Fix seed.ts
replaceFile('src/db/seeds/seed.ts', [
  [
    "memberId: membersData[0].id,",
    "organizationId: orgId,\n      branchId: branchId,\n      memberId: membersData[0].id,"
  ],
  [
    "membershipId: activeMem.id,",
    "organizationId: orgId,\n        branchId: branchId,\n        membershipId: activeMem.id,"
  ],
  [
    "planId: plans[0].id,",
    "organizationId: orgId,\n      branchId: branchId,\n      planId: plans[0].id,"
  ]
]);

console.log('Done fixing seed.ts');
