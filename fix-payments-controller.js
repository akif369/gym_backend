const fs = require('fs');

// Fix memberships.service.ts line 61
let memService = fs.readFileSync('src/modules/memberships/memberships.service.ts', 'utf8');
memService = memService.replace(
  /generateMembershipInvoiceService\(ctx\.organizationId, \{([^}]+)\}, ctx\.userId\);/g,
  "generateMembershipInvoiceService(ctx, {$1});"
);
fs.writeFileSync('src/modules/memberships/memberships.service.ts', memService);

// Fix payments.service.ts
let payService = fs.readFileSync('src/modules/payments/payments.service.ts', 'utf8');
payService = payService.replace(/invoice-number:\$\{orgId\}/g, "invoice-number:${ctx.organizationId}");
payService = payService.replace(/generateInvoiceNumber\(orgId, invoiceSettings\.prefix\)/g, "generateInvoiceNumber(ctx, invoiceSettings.prefix)");
payService = payService.replace(/organizationId: orgId/g, "organizationId: ctx.organizationId");
payService = payService.replace(/createdBy: actorId/g, "createdBy: ctx.userId");
fs.writeFileSync('src/modules/payments/payments.service.ts', payService);

// Fix payments.controller.ts
let payController = fs.readFileSync('src/modules/payments/payments.controller.ts', 'utf8');
payController = payController.replace(/request\.user\.orgId/g, 'request.user');
payController = payController.replace(/,\s*request\.user\.userId/g, '');
fs.writeFileSync('src/modules/payments/payments.controller.ts', payController);

console.log('Fixed payments controller and service');
