const fs = require('fs');
let content = fs.readFileSync('src/modules/biometrics/biometrics.service.ts', 'utf8');

// Imports
if (!content.includes('tenantWhere')) {
  content = content.replace(
    "import { TenantContext } from '../../common/auth/tenant';",
    "import { TenantContext, tenantWhere, accessibleBranchesWhere } from '../../common/auth/tenant';"
  );
}

// calculateMemberAccessGroup
content = content.replace(
  "export async function calculateMemberAccessGroup(orgId: string, memberId: string, tx: any = db): Promise<number> {",
  "export async function calculateMemberAccessGroup(ctx: TenantContext, memberId: string, tx: any = db): Promise<number> {"
);
content = content.replace(
  "const systemCtx: TenantContext = {\n    organizationId: orgId,\n    activeBranchId: null,\n    accessibleBranchIds: [],\n    userId: 'SYSTEM',\n    role: 'SUPER_ADMIN',\n    permissions: [],\n    organizationMode: 'SINGLE_GYM', // default dummy\n  };\n  const status = await getMemberAccessStatusService(systemCtx, memberId, tx);",
  "const status = await getMemberAccessStatusService(ctx, memberId, tx);"
);

// We must also update references to calculateMemberAccessGroup inside this file!
content = content.replace(
  /calculateMemberAccessGroup\(orgId, m\.id\)/g,
  "calculateMemberAccessGroup(ctx, m.id)"
);
content = content.replace(
  /calculateMemberAccessGroup\(orgId, memberId\)/g,
  "calculateMemberAccessGroup(ctx, memberId)"
);

// listDevicesService
content = content.replace(
  "export async function listDevicesService(orgId: string) {",
  "export async function listDevicesService(ctx: TenantContext) {"
);
content = content.replace(
  "where(eq(biometricDevices.organizationId, orgId))",
  "where(and(tenantWhere(biometricDevices, ctx), accessibleBranchesWhere(biometricDevices, ctx)))"
);

// listIdentitiesService
content = content.replace(
  "export async function listIdentitiesService(orgId: string) {",
  "export async function listIdentitiesService(ctx: TenantContext) {"
);
content = content.replace(
  "where(eq(organizations.id, orgId))",
  "where(eq(organizations.id, ctx.organizationId))"
);
content = content.replace(
  "where(eq(members.organizationId, orgId))",
  "where(and(tenantWhere(members, ctx), accessibleBranchesWhere(members, ctx)))"
);

// registerDeviceService
content = content.replace(
  "export async function registerDeviceService(orgId: string, data: { branchId: string; serialNumber: string; deviceName: string; deviceType?: string; purpose?: any }) {",
  "export async function registerDeviceService(ctx: TenantContext, data: { branchId: string; serialNumber: string; deviceName: string; deviceType?: string; purpose?: any }) {"
);
content = content.replace(
  "organizationId: orgId,",
  "organizationId: ctx.organizationId,"
);

// deleteDeviceService
content = content.replace(
  "export async function deleteDeviceService(orgId: string, deviceId: string) {",
  "export async function deleteDeviceService(ctx: TenantContext, deviceId: string) {"
);
content = content.replace(
  "where(and(eq(biometricDevices.id, deviceId), eq(biometricDevices.organizationId, orgId)))",
  "where(and(eq(biometricDevices.id, deviceId), tenantWhere(biometricDevices, ctx), accessibleBranchesWhere(biometricDevices, ctx)))"
);

// syncMemberBiometricAccessService
content = content.replace(
  "export async function syncMemberBiometricAccessService(\n  orgId: string,\n  memberId: string,\n  options?: { force?: boolean; explicitPin?: string; explicitName?: string; explicitGroup?: number; explicitBranchId?: string }\n) {",
  "export async function syncMemberBiometricAccessService(\n  ctx: TenantContext,\n  memberId: string,\n  options?: { force?: boolean; explicitPin?: string; explicitName?: string; explicitGroup?: number; explicitBranchId?: string }\n) {"
);
content = content.replace(
  "eq(members.organizationId, orgId)",
  "tenantWhere(members, ctx)"
);
content = content.replace(
  "where(eq(biometricDevices.organizationId, orgId))",
  "where(tenantWhere(biometricDevices, ctx))"
);
content = content.replace(
  "organizationId: orgId,",
  "organizationId: ctx.organizationId,"
);

// reconcileBiometricAccessService
content = content.replace(
  "export async function reconcileBiometricAccessService(orgId: string, branchId?: string | null) {",
  "export async function reconcileBiometricAccessService(ctx: TenantContext, branchId?: string | null) {"
);
content = content.replace(
  "const branchConditions: any[] = [eq(biometricDevices.organizationId, orgId)];",
  "const branchConditions: any[] = [tenantWhere(biometricDevices, ctx)];"
);
content = content.replace(
  "eq(members.organizationId, orgId),",
  "tenantWhere(members, ctx),"
);
content = content.replace(
  /syncMemberBiometricAccessService\(orgId, m\.id, \{ explicitGroup: targetGroup \}\)/g,
  "syncMemberBiometricAccessService(ctx, m.id, { explicitGroup: targetGroup })"
);


// syncMemberToBiometricsService
content = content.replace(
  "export async function syncMemberToBiometricsService(\n  orgId: string,\n  branchId: string,\n  memberId: string,\n  pin: string,\n  name: string,\n  accessGroup?: number\n) {",
  "export async function syncMemberToBiometricsService(\n  ctx: TenantContext,\n  branchId: string,\n  memberId: string,\n  pin: string,\n  name: string,\n  accessGroup?: number\n) {"
);
content = content.replace(
  "return syncMemberBiometricAccessService(orgId, memberId, {",
  "return syncMemberBiometricAccessService(ctx, memberId, {"
);

// deleteBiometricIdentityService
content = content.replace(
  "export async function deleteBiometricIdentityService(orgId: string, identityId: string) {",
  "export async function deleteBiometricIdentityService(ctx: TenantContext, identityId: string) {"
);
content = content.replace(
  "where(and(eq(biometricDevices.id, identity.deviceId), eq(biometricDevices.organizationId, orgId)))",
  "where(and(eq(biometricDevices.id, identity.deviceId), tenantWhere(biometricDevices, ctx)))"
);
content = content.replace(
  "organizationId: orgId,",
  "organizationId: ctx.organizationId,\n    branchId: device.branchId,"
);

// In processAdmsDeviceCmd we need to inject branchId for identity insert/update
content = content.replace(
  "await db.insert(biometricIdentities).values({",
  "await db.insert(biometricIdentities).values({\n        organizationId: device.organizationId,\n        branchId: device.branchId,"
);

// Wait, I missed inserting branchId when identities are inserted in syncMemberBiometricAccessService
content = content.replace(
  "      await db.insert(biometricIdentities).values({\n        memberId,\n        deviceId: device.id,",
  "      await db.insert(biometricIdentities).values({\n        organizationId: ctx.organizationId,\n        branchId: device.branchId,\n        memberId,\n        deviceId: device.id,"
);

// And branchId in biometricDeviceCommands in syncMemberBiometricAccessService
content = content.replace(
  "      organizationId: ctx.organizationId,\n      deviceId: device.id,",
  "      organizationId: ctx.organizationId,\n      branchId: device.branchId,\n      deviceId: device.id,"
);


fs.writeFileSync('src/modules/biometrics/biometrics.service.ts', content);
console.log('Fixed biometrics.service.ts');
