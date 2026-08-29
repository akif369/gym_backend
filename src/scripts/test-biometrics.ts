import * as dotenv from 'dotenv';
dotenv.config();

import { db } from '../db/index';
import {
  organizations,
  branches,
  members,
  membershipPlans,
  memberMemberships,
  biometricDevices,
  biometricIdentities,
  biometricDeviceCommands,
} from '../db/schema/index';
import {
  calculateMemberAccessGroup,
  syncMemberBiometricAccessService,
  reconcileBiometricAccessService,
  processAdmsGetRequest,
  processAdmsDeviceCmd,
} from '../modules/biometrics/biometrics.service';
import { expireDueMembershipsService } from '../modules/memberships/memberships.service';
import { eq, and } from 'drizzle-orm';

async function runTest() {
  console.log('--- Starting ZKTeco Biometrics Access Control Test ---');

  // 1. Get or create test org & branch
  let [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    [org] = await db.insert(organizations).values({
      name: 'Test Gym Org',
      slug: 'test-gym-org-' + Date.now(),
      phone: '+919876543210',
      timezone: 'Asia/Kolkata',
    }).returning();
  }

  let [branch] = await db.select().from(branches).where(eq(branches.organizationId, org!.id)).limit(1);
  if (!branch) {
    [branch] = await db.insert(branches).values({
      organizationId: org!.id,
      name: 'Main Branch',
    }).returning();
  }
  const ctx: any = { organizationId: org!.id, activeBranchId: branch!.id, accessibleBranchIds: [branch!.id], userId: 'SYSTEM', role: 'ADMIN' };

  // Clear previous test devices & members for this org to ensure idempotency
  await db.delete(biometricDevices).where(eq(biometricDevices.organizationId, org!.id));

  // 2. Register test ZKTeco F09 device
  const deviceSn = 'TESTF09_' + Date.now();
  const [device] = await db.insert(biometricDevices).values({
    organizationId: org!.id,
    branchId: branch!.id,
    serialNumber: deviceSn,
    deviceName: 'Turnstile F09 Test',
    deviceType: 'F09',
    purpose: 'ENTRY',
  }).returning();

  console.log(`✓ Registered test device: ${device!.deviceName} (SN: ${deviceSn})`);

  // 3. Create test member
  const memberNum = 'GYM' + Math.floor(1000 + Math.random() * 9000);
  const [member] = await db.insert(members).values({
    organizationId: org!.id,
    branchId: branch!.id,
    memberNumber: memberNum,
    firstName: 'Arjun',
    lastName: 'Sharma',
    phone: '+919876500001',
    status: 'ACTIVE',
    joinDate: '2026-01-01',
  }).returning();

  console.log(`✓ Created member ${member!.firstName} ${member!.lastName} (${memberNum})`);

  // 4. Test calculation with no active membership -> Expect Group 99
  let group = await calculateMemberAccessGroup(ctx, member!.id);
  console.log(`Test 1: Access Group without active membership -> Group ${group} (Expected: 99)`);
  if (group !== 99) throw new Error('Expected Group 99 for member with no active membership');

  // 5. Create active membership plan and assign to member
  const [plan] = await db.insert(membershipPlans).values({
    organizationId: org!.id,
    branchId: branch!.id,
    name: 'Annual Pass',
    price: '12000',
    durationDays: 365,
    status: 'ACTIVE',
  }).returning();

  const [activeMembership] = await db.insert(memberMemberships).values({
    organizationId: org!.id,
    branchId: branch!.id,
    memberId: member!.id,
    planId: plan!.id,
    planName: plan!.name,
    startAt: new Date('2026-01-01T00:00:00+05:30'),
    expiresAt: new Date('2027-01-01T00:00:00+05:30'),
    timezone: 'Asia/Kolkata',
    status: 'ACTIVE',
  }).returning();

  // 6. Test calculation with active membership -> Expect Group 1
  group = await calculateMemberAccessGroup(ctx, member!.id);
  console.log(`Test 2: Access Group with valid active membership -> Group ${group} (Expected: 1)`);
  if (group !== 1) throw new Error('Expected Group 1 for active member');

  // 7. Sync member to biometrics -> Expect command queued with Grp=1
  const syncResult1 = await syncMemberBiometricAccessService(ctx, member!.id);
  console.log(`Test 3: Initial sync result -> Queued: ${syncResult1.count}, TargetGroup: ${syncResult1.targetGroup}`);
  if (syncResult1.count < 1 || syncResult1.targetGroup !== 1) throw new Error('Failed to queue Group 1 command');

  // Check command queue
  const admsCmd = await processAdmsGetRequest(deviceSn);
  console.log(`Test 4: ADMS getrequest returned command -> ${admsCmd}`);
  if (!admsCmd.includes('Grp=1')) throw new Error('ADMS command string missing Grp=1');

  // Device sends confirmation devicecmd
  const cmdIdMatch = admsCmd.match(/C:([a-f0-9-]+):/);
  if (cmdIdMatch && cmdIdMatch[1]) {
    await processAdmsDeviceCmd(deviceSn, `ID=${cmdIdMatch[1]}&Return=0`);
    console.log(`Test 5: Processed device command response Return=0 for cmd ${cmdIdMatch[1]}`);
  }

  const [identity] = await db.select().from(biometricIdentities)
    .where(and(eq(biometricIdentities.deviceId, device!.id), eq(biometricIdentities.memberId, member!.id)));
  console.log(`Test 6: Identity syncStatus after device callback -> ${identity?.syncStatus}, AccessGroup: ${identity?.accessGroup}`);
  if (identity?.syncStatus !== 'SYNCED' || identity?.accessGroup !== 1) throw new Error('Identity not marked SYNCED');

  // 8. Test smart delta diffing -> Second sync should queue 0 commands because already SYNCED and Grp=1
  const deltaSyncResult = await syncMemberBiometricAccessService(ctx, member!.id);
  console.log(`Test 7: Smart Delta Diff Check (no status change) -> Commands queued: ${deltaSyncResult.count} (Expected: 0)`);
  if (deltaSyncResult.count !== 0) throw new Error('Smart delta diff failed, queued redundant command');

  // 9. Simulate membership expiry sweep -> move exclusive expiry into the past.
  await db.update(memberMemberships)
    .set({ expiresAt: new Date('2026-01-01T00:00:00+05:30') })
    .where(eq(memberMemberships.id, activeMembership!.id));

  console.log('Simulating daily sweep: running expireDueMembershipsService()...');
  const sweepResult = await expireDueMembershipsService();
  console.log(`Sweep result -> Expired: ${sweepResult.expired}`);

  // Check updated target group and command queue for device
  const expiredCmd = await processAdmsGetRequest(deviceSn);
  console.log(`Test 8: ADMS getrequest after sweep -> ${expiredCmd}`);
  if (!expiredCmd.includes('Grp=99')) throw new Error('ADMS command string did not update to Grp=99 on expiry');

  // Device confirms Group 99 update
  const expiredCmdIdMatch = expiredCmd.match(/C:([a-f0-9-]+):/);
  if (expiredCmdIdMatch && expiredCmdIdMatch[1]) {
    await processAdmsDeviceCmd(deviceSn, `ID=${expiredCmdIdMatch[1]}&Return=0`);
  }

  const [expiredIdentity] = await db.select().from(biometricIdentities)
    .where(and(eq(biometricIdentities.deviceId, device!.id), eq(biometricIdentities.memberId, member!.id)));
  console.log(`Test 9: Identity after expiry sweep & confirmation -> AccessGroup: ${expiredIdentity?.accessGroup}, syncStatus: ${expiredIdentity?.syncStatus}`);
  if (expiredIdentity?.accessGroup !== 99 || expiredIdentity?.syncStatus !== 'SYNCED') throw new Error('Identity not marked Group 99 SYNCED');

  // 10. Reconcile test
  const reconcileRes = await reconcileBiometricAccessService(ctx, branch!.id);
  console.log('Test 10: Reconcile sweep result ->', reconcileRes);

  console.log('🎉 ALL ZKTeco F09 BIOMETRIC ACCESS CONTROL TESTS PASSED SUCCESSFULLY! 🎉');

  // Clean up test data
  await db.delete(biometricDevices).where(eq(biometricDevices.id, device!.id));
  await db.delete(members).where(eq(members.id, member!.id));
  await db.delete(membershipPlans).where(eq(membershipPlans.id, plan!.id));
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });
