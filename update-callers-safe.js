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
    
    // specifically target sendTextMessage({ ... }) and sendMediaMessage({ ... })
    // In memberships.service.ts, the caller might use `organizationId: systemCtx.organizationId`
    // Wait, let's just use string replacement carefully!
    
    content = content.replace(
      "sendTextMessage({\n      organizationId: ctx.organizationId",
      "sendTextMessage({\n      ctx: ctx"
    );
    
    content = content.replace(
      "sendTextMessage({\n      organizationId: systemCtx.organizationId",
      "sendTextMessage({\n      ctx: systemCtx"
    );
    
    content = content.replace(
      "sendMediaMessage({\n      organizationId: ctx.organizationId",
      "sendMediaMessage({\n      ctx: ctx"
    );

    content = content.replace(
      "sendTextMessage({\n        organizationId: ctx.organizationId",
      "sendTextMessage({\n        ctx: ctx"
    );

    content = content.replace(
      "sendTextMessage({\n          organizationId: ctx.organizationId",
      "sendTextMessage({\n          ctx: ctx"
    );
    
    fs.writeFileSync(f, content);
  }
}
console.log('Callers safely updated');
