const fs = require('fs');

// 1. trainers.service.ts
let tService = fs.readFileSync('src/modules/trainers/trainers.service.ts', 'utf8');

// Add imports
if (!tService.includes('tenantWhere')) {
  tService = tService.replace(
    "import { db } from '../../db/index';",
    "import { db } from '../../db/index';\nimport { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';"
  );
}

// Global replace orgId -> ctx
tService = tService.replace(/export async function (.*?)\(orgId: string,/g, "export async function $1(ctx: TenantContext,");

// Update conditions
tService = tService.replace(/eq\(trainers\.organizationId, orgId\)/g, "tenantWhere(trainers, ctx), accessibleBranchesWhere(trainers, ctx)");
tService = tService.replace(/organizationId: orgId/g, "organizationId: ctx.organizationId");
tService = tService.replace(/organizationId: orgId,/g, "organizationId: ctx.organizationId, branchId: data.branchId || ctx.activeBranchId,");

// Also when calling getTrainerService internally
tService = tService.replace(/getTrainerService\(orgId,/g, "getTrainerService(ctx,");

// In assignMembersService, add branchId to assignment
tService = tService.replace(
  "trainerId, memberId, assignedBy: actorId",
  "organizationId: ctx.organizationId, branchId: ctx.activeBranchId, trainerId, memberId, assignedBy: actorId"
);

fs.writeFileSync('src/modules/trainers/trainers.service.ts', tService);

// 2. trainers.controller.ts
let tController = fs.readFileSync('src/modules/trainers/trainers.controller.ts', 'utf8');

tController = tController.replace(/request\.user\.orgId/g, 'request.user');
tController = tController.replace(/request\.user\.userId/g, 'request.user.userId'); // leaving actorId for some?
// Wait, in controller:
// assignMembersService(request.user.orgId, trainerId, body.memberIds, request.user.userId) -> assignMembersService(request.user, trainerId, body.memberIds, request.user.userId)
// removeTrainerMemberService(request.user.orgId, trainerId, memberId, request.user.userId) -> removeTrainerMemberService(request.user, trainerId, memberId, request.user.userId)

fs.writeFileSync('src/modules/trainers/trainers.controller.ts', tController);

console.log('Fixed trainers module');
