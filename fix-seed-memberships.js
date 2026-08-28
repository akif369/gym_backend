const fs = require('fs');
let seedContent = fs.readFileSync('src/db/seeds/seed.ts', 'utf8');

seedContent = seedContent.replace(
  /await tx\.insert\(memberMemberships\)\.values\(membership\);/g,
  "await tx.insert(memberMemberships).values({ ...membership, organizationId: orgId, branchId: mainBranchId });"
);

seedContent = seedContent.replace(
  /await tx\.insert\(membershipEvents\)\.values\(\{/g,
  "await tx.insert(membershipEvents).values({\n        organizationId: orgId,\n        branchId: mainBranchId,"
);

// Wait, the seed file has another `tx.insert(memberMemberships).values({` block further down around line 250?
// Let's replace any `memberMemberships` insertions that are missing organizationId.
seedContent = seedContent.replace(
  /await tx\.insert\(memberMemberships\)\.values\(\{\n        memberId:/g,
  "await tx.insert(memberMemberships).values({\n        organizationId: orgId,\n        branchId: mainBranchId,\n        memberId:"
);

fs.writeFileSync('src/db/seeds/seed.ts', seedContent);
console.log('Fixed seed.ts');
