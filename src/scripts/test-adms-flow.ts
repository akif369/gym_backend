import { db } from '../db/index';
import { members, organizations, branches } from '../db/schema/index';
import { biometricDevices, biometricDeviceCommands, biometricIdentities } from '../db/schema/biometrics.schema';
import { syncMemberBiometricAccessService, processAdmsGetRequest, processAdmsDeviceCmd } from '../modules/biometrics/biometrics.service';
import { eq, desc, isNotNull, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('--- STARTING ADMS FLOW TEST ---');

  // Let's create proper mock objects with all required fields
  const orgId = uuidv4();
  const branchId = uuidv4();
  const slug = 'test-org-' + Date.now();
  
  await db.insert(organizations).values({ 
    id: orgId,
    name: 'Test Org', 
    slug: slug, 
    timezone: 'Asia/Kolkata', 
    currency: 'INR'
  });
  
  await db.insert(branches).values({ 
    id: branchId,
    organizationId: orgId, 
    name: 'Test Branch',
    slug: slug + '-branch' 
  });
  
  const [device] = await db.insert(biometricDevices).values({
    organizationId: orgId,
    branchId: branchId,
    serialNumber: 'TEST-F09-' + Date.now(),
    deviceName: 'Test F09',
    protocol: 'ADMS'
  }).returning();
  
  const [member] = await db.insert(members).values({
    organizationId: orgId,
    branchId: branchId,
    firstName: 'Test',
    lastName: 'User',
    memberNumber: '1001' + Date.now().toString().substring(8),
    status: 'ACTIVE',
    phone: '1234567890',
    email: 'test@example.com',
    joinDate: new Date().toISOString() as any
  }).returning();

  console.log('1. Created test entities.');
  console.log('   Device SN:', device.serialNumber);
  console.log('   Member:', member.firstName, member.lastName, 'PIN:', member.memberNumber);

  // Simulate active user sync
  console.log('\n2. Queue active sync (Group 1, Pri 0)...');
  await syncMemberBiometricAccessService(orgId, member.id, { force: true, explicitGroup: 1, explicitPin: member.memberNumber });

  // ADMS GetRequest
  console.log('\n3. Simulating ADMS GETREQUEST from device...');
  let reqResponse = await processAdmsGetRequest(device.serialNumber);
  console.log('   Response from server:', JSON.stringify(reqResponse));

  // Extract ID
  let match = reqResponse.match(/C:(\d+):/);
  if (!match) throw new Error("Could not find numeric ID in response");
  let admsId = match[1];

  // ADMS DeviceCmd ACK
  console.log(`\n4. Simulating device ACK for ID ${admsId}...`);
  await processAdmsDeviceCmd(device.serialNumber, `ID=${admsId}&Return=0&CMD=DATA`);

  // Check state
  let [identity] = await db.select().from(biometricIdentities).where(eq(biometricIdentities.memberId, member.id));
  console.log('   Identity Status:', {
    accessGroup: identity.accessGroup,
    syncStatus: identity.syncStatus,
    pin: identity.deviceUserId
  });

  // Simulate denied user sync
  console.log('\n5. Queue denied sync (Group 99, Pri 1)...');
  await syncMemberBiometricAccessService(orgId, member.id, { force: true, explicitGroup: 99, explicitPin: member.memberNumber });

  // ADMS GetRequest 2
  console.log('\n6. Simulating ADMS GETREQUEST from device...');
  reqResponse = await processAdmsGetRequest(device.serialNumber);
  console.log('   Response from server:', JSON.stringify(reqResponse));

  match = reqResponse.match(/C:(\d+):/);
  if (!match) throw new Error("Could not find numeric ID in response");
  admsId = match[1];

  // ADMS DeviceCmd ACK 2
  console.log(`\n7. Simulating device ACK for ID ${admsId}...`);
  await processAdmsDeviceCmd(device.serialNumber, `ID=${admsId}&Return=0&CMD=DATA`);

  // Check state 2
  [identity] = await db.select().from(biometricIdentities).where(eq(biometricIdentities.memberId, member.id));
  console.log('   Identity Status:', {
    accessGroup: identity.accessGroup,
    syncStatus: identity.syncStatus,
    pin: identity.deviceUserId
  });

  console.log('\n--- FLOW TEST COMPLETED SUCCESSFULLY ---');
  process.exit(0);
}

main().catch(console.error);
