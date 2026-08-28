const fs = require('fs');
const glob = require('glob');

// 1. In notifications.service.ts
let ns = fs.readFileSync('src/modules/notifications/notifications.service.ts', 'utf8');

if (!ns.includes('TenantContext')) {
  ns = ns.replace(
    "import { createLogger } from '../../common/logger/index';",
    "import { createLogger } from '../../common/logger/index';\nimport { TenantContext } from '../../common/auth/tenant';"
  );
}

ns = ns.replace(
  "type SendTextInput = {\n  organizationId: string;",
  "type SendTextInput = {\n  ctx: TenantContext;"
);

ns = ns.replace(/input\.organizationId/g, 'input.ctx.organizationId');

// Add branchId to insertion
ns = ns.replace(
  "organizationId: input.ctx.organizationId,\n    memberId: input.memberId,",
  "organizationId: input.ctx.organizationId,\n    branchId: input.ctx.activeBranchId,\n    memberId: input.memberId,"
);

fs.writeFileSync('src/modules/notifications/notifications.service.ts', ns);

// 2. In notifications.controller.ts
let nc = fs.readFileSync('src/modules/notifications/notifications.controller.ts', 'utf8');
nc = nc.replace(
  "organizationId: request.user.orgId,",
  "ctx: request.user,"
);
fs.writeFileSync('src/modules/notifications/notifications.controller.ts', nc);

console.log('Fixed notifications');
