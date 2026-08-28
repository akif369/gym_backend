const fs = require('fs');

const filesToUpdate = [
  'src/modules/payments/payments.service.ts',
  'src/modules/staff/staff.service.ts',
  'src/modules/memberships/memberships.service.ts',
  'src/modules/members/members.service.ts'
];

for (const f of filesToUpdate) {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/organizationId: (.*?)\.organizationId,/g, "ctx: $1,");
    content = content.replace(/organizationId: orgId,/g, "ctx,");
    
    // specifically for membership sweep:
    // candidate.organizationId is passed.
    // wait, I made `systemCtx` for membership sweep!
    // So systemCtx.organizationId will become ctx: systemCtx.
    content = content.replace(/organizationId: systemCtx.organizationId,/g, "ctx: systemCtx,");
    content = content.replace(/organizationId: ctx.organizationId,/g, "ctx: ctx,");
    
    fs.writeFileSync(f, content);
  }
}
console.log('Callers updated');
