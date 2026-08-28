const fs = require('fs');

function replaceFile(path, replaces) {
  let content = fs.readFileSync(path, 'utf8');
  for (const [from, to] of replaces) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(path, content);
}

// Fix attendance.controller.ts
replaceFile('src/modules/attendance/attendance.controller.ts', [
  ['request.user.orgId', 'request.user'],
  [', request.user.userId', ''],
  ['request.user, request.user.branchId ?? undefined, request.body as any', 'request.user, request.body as any'],
  ['{ ...body, method: \'QR\' }', '{ ...(body as any), method: \'QR\' }'],
  ['{ ...body, method: \'RFID\' }', '{ ...(body as any), method: \'RFID\' }'],
]);

// Fix members.controller.ts
replaceFile('src/modules/members/members.controller.ts', [
  ['request.user.orgId', 'request.user'],
  [', request.user.userId', ''],
  ['await isStrictPaymentPolicyEnabled(request.user)', 'await isStrictPaymentPolicyEnabled(request.user.organizationId)'],
  ['request.user, request.params.memberId, request.user.userId, deletionReason', 'request.user, request.params.memberId, deletionReason'],
]);

// Fix members.service.ts
replaceFile('src/modules/members/members.service.ts', [
  ['eq(members.organizationId, orgId)', 'tenantWhere(members, ctx), accessibleBranchesWhere(members, ctx)'],
  ['organizationId: orgId', 'organizationId: ctx.organizationId'],
  ['actorId,', 'actorId: ctx.userId,'],
  ['actorId', 'ctx.userId'],
  ['orgId', 'ctx.organizationId'],
  ['ctx.organizationId: string', 'orgId: string'],
  ['export async function updateMemberService(\n  ctx.organizationId: string,\n  memberId: string,\n  data: Partial<typeof members.$inferInsert>,\n  ctx.userId: string,\n)', 'export async function updateMemberService(\n  ctx: TenantContext,\n  memberId: string,\n  data: Partial<typeof members.$inferInsert>,\n)'],
  ['export async function updateMemberStatusService(\n  ctx.organizationId: string,\n  memberId: string,\n  status: string,\n  ctx.userId: string,\n)', 'export async function updateMemberStatusService(\n  ctx: TenantContext,\n  memberId: string,\n  status: string,\n)'],
  ['export async function deleteMemberService(\n  ctx.organizationId: string,\n  memberId: string,\n  ctx.userId: string,\n  deletionReason?: string,\n)', 'export async function deleteMemberService(\n  ctx: TenantContext,\n  memberId: string,\n  deletionReason?: string,\n)'],
  ['export async function hardDeleteMemberService(\n  ctx.organizationId: string,\n  memberId: string,\n  ctx.userId: string,\n)', 'export async function hardDeleteMemberService(\n  ctx: TenantContext,\n  memberId: string,\n)'],
  ['export async function getMemberDeletionSummaryService(\n  ctx.organizationId: string,\n  memberId: string,\n)', 'export async function getMemberDeletionSummaryService(\n  ctx: TenantContext,\n  memberId: string,\n)'],
  ['export async function getMemberActivityService(ctx.organizationId: string, memberId: string)', 'export async function getMemberActivityService(ctx: TenantContext, memberId: string)'],
  ['export async function getMemberMeasurementsService(ctx.organizationId: string, memberId: string)', 'export async function getMemberMeasurementsService(ctx: TenantContext, memberId: string)'],
  ['export async function addMemberMeasurementService(\n  ctx.organizationId: string,\n  memberId: string,\n  data: Omit<typeof memberMeasurements.$inferInsert, \'id\' | \'memberId\' | \'createdAt\'>,\n  ctx.userId: string,\n)', 'export async function addMemberMeasurementService(\n  ctx: TenantContext,\n  memberId: string,\n  data: Omit<typeof memberMeasurements.$inferInsert, \'id\' | \'memberId\' | \'createdAt\'>,\n)'],
  ['export async function getMemberHealthProfileService(ctx.organizationId: string, memberId: string)', 'export async function getMemberHealthProfileService(ctx: TenantContext, memberId: string)'],
  ['export async function updateMemberHealthProfileService(\n  ctx.organizationId: string,\n  memberId: string,\n  data: Partial<typeof memberHealthProfiles.$inferInsert>,\n  ctx.userId: string,\n)', 'export async function updateMemberHealthProfileService(\n  ctx: TenantContext,\n  memberId: string,\n  data: Partial<typeof memberHealthProfiles.$inferInsert>,\n)'],
  ['export async function uploadMemberPhotoService(\n  ctx.organizationId: string,\n  memberId: string,\n  fileBuffer: Buffer,\n  filename: string,\n  ctx.userId: string,\n)', 'export async function uploadMemberPhotoService(\n  ctx: TenantContext,\n  memberId: string,\n  fileBuffer: Buffer,\n  filename: string,\n)'],
  ['export async function deleteMemberPhotoService(\n  ctx.organizationId: string,\n  memberId: string,\n  ctx.userId: string,\n)', 'export async function deleteMemberPhotoService(\n  ctx: TenantContext,\n  memberId: string,\n)'],
  ['export async function getMemberAccessStatusService(ctx.organizationId: string, memberId: string, tx: any = db)', 'export async function getMemberAccessStatusService(ctx: TenantContext, memberId: string, tx: any = db)'],
]);
