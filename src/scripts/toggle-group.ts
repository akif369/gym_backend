/**
 * toggle-f09-user.ts
 *
 * Independent ZKTeco F09 user/group toggle.
 *
 * Usage:
 *   npm run biometrics:test:user1
 *
 * Optional:
 *   npx tsx src/scripts/toggle-group.ts 1 1 99 NYU7262003002
 *
 * Meaning:
 *   PIN = 1
 *   Group A = 1
 *   Group B = 99
 *   Device serial = NYU7262003002 (optional when PIN is unique)
 *
 * The script:
 *   1. Fetches biometric identity by deviceUserId/PIN
 *   2. Fetches the linked member
 *   3. Fetches the linked biometric device
 *   4. Reads the current access group
 *   5. Calculates the opposite group
 *   6. Creates an ADMS command
 *   7. Waits for the command to be delivered/executed
 *   8. Updates the identity only after COMPLETED
 */

import * as dotenv from 'dotenv';

dotenv.config();

import { db, closeDatabaseConnection } from '../db/index';

import {
  biometricIdentities,
  biometricDevices,
  biometricDeviceCommands,
  members,
} from '../db/schema/index';

import { eq, and, sql } from 'drizzle-orm';

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

const PIN = process.argv[2] ?? '1';

// These MUST exist/configured on the F09.
const GROUP_A = Number(process.argv[3] ?? 1);
const GROUP_B = Number(process.argv[4] ?? 99);
const DEVICE_SERIAL = process.argv[5]?.trim() || undefined;

if (!Number.isInteger(GROUP_A) || !Number.isInteger(GROUP_B) || GROUP_A < 0 || GROUP_B < 0) {
  throw new Error('Groups must be non-negative integers.');
}

// How long to wait for the device.
const TIMEOUT_MS = 120_000;

// Poll database every 2 seconds.
const POLL_INTERVAL_MS = 2_000;

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeGroup(value: unknown): number {
  const group = Number(value);

  if (!Number.isFinite(group)) {
    return GROUP_A;
  }

  return group;
}

function calculateNextGroup(currentGroup: number): number {
  if (currentGroup === GROUP_A) {
    return GROUP_B;
  }

  if (currentGroup === GROUP_B) {
    return GROUP_A;
  }

  /*
   * If the current DB value is something unexpected,
   * don't blindly send an arbitrary group.
   *
   * Example:
   * current = 5
   *
   * We choose GROUP_A as the safe starting point.
   */
  console.warn(
    `⚠ Current group ${currentGroup} is neither ${GROUP_A} nor ${GROUP_B}.`
  );

  return GROUP_A;
}

// ------------------------------------------------------------
// FETCH USER
// ------------------------------------------------------------

async function fetchUserByPin(pin: string) {
  console.log(`\n🔎 Searching biometric identity for PIN "${pin}"...`);

  const identities = await db
    .select()
    .from(biometricIdentities)
    .where(eq(biometricIdentities.deviceUserId, pin));

  const matchingIdentities = DEVICE_SERIAL
    ? (await Promise.all(identities.map(async identity => {
        const [device] = await db.select({ id: biometricDevices.id })
          .from(biometricDevices)
          .where(and(eq(biometricDevices.id, identity.deviceId), eq(biometricDevices.serialNumber, DEVICE_SERIAL)))
          .limit(1);
        return device ? identity : null;
      }))).filter((identity): identity is NonNullable<typeof identity> => identity !== null)
    : identities;

  if (matchingIdentities.length > 1) {
    throw new Error(`PIN "${pin}" exists on multiple devices. Pass the device serial as argument 5.`);
  }

  const identity = matchingIdentities[0];

  if (!identity) {
    throw new Error(
      `No biometric identity found for PIN "${pin}".`
    );
  }

  console.log('✓ Biometric identity found');
  console.log('  Identity ID:', identity.id);
  console.log('  Member ID:', identity.memberId);
  console.log('  Device ID:', identity.deviceId);
  console.log('  Device User ID:', identity.deviceUserId);
  console.log('  Current Access Group:', identity.accessGroup);

  return identity;
}

// ------------------------------------------------------------
// FETCH MEMBER
// ------------------------------------------------------------

async function fetchMember(memberId: string) {
  console.log(`\n🔎 Fetching member ${memberId}...`);

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) {
    throw new Error(
      `Member "${memberId}" does not exist.`
    );
  }

  console.log('✓ Member found');
  console.log(
    '  Name:',
    `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()
  );
  console.log('  Organization:', member.organizationId);

  return member;
}

// ------------------------------------------------------------
// FETCH DEVICE
// ------------------------------------------------------------

async function fetchDevice(deviceId: string) {
  console.log(`\n🔎 Fetching biometric device ${deviceId}...`);

  const [device] = await db
    .select()
    .from(biometricDevices)
    .where(eq(biometricDevices.id, deviceId))
    .limit(1);

  if (!device) {
    throw new Error(
      `Biometric device "${deviceId}" does not exist.`
    );
  }

  console.log('✓ Device found');
  console.log('  Name:', device.deviceName);
  console.log('  Type:', device.deviceType);
  console.log('  Serial:', device.serialNumber);
  console.log('  Protocol:', device.protocol);
  console.log('  Status:', device.status);
  console.log('  Last Seen:', device.lastSeenAt);

  return device;
}

// ------------------------------------------------------------
// CHECK DEVICE HEALTH
// ------------------------------------------------------------

function checkDeviceHealth(device: any) {
  console.log('\n📡 Checking device health...');

  if (!device.lastSeenAt) {
    console.warn(
      '⚠ Device has no lastSeenAt value.'
    );

    return;
  }

  const ageMs =
    Date.now() - new Date(device.lastSeenAt).getTime();

  const ageSeconds = Math.round(ageMs / 1000);

  console.log(
    `  Last contact: ${ageSeconds}s ago`
  );

  if (ageMs > 5 * 60 * 1000) {
    console.warn(
      `⚠ Device has not contacted the server for ${Math.round(
        ageMs / 1000 / 60
      )} minutes.`
    );
  } else {
    console.log('✓ Device recently contacted server');
  }
}

// ------------------------------------------------------------
// BUILD COMMAND
// ------------------------------------------------------------

function buildCommand(
  pin: string,
  member: any,
  newGroup: number
) {
  const name =
    `${member.firstName ?? ''} ${member.lastName ?? ''}`
      .trim()
      .substring(0, 24);

  /*
   * ZKTeco PUSH/ADMS user update.
   *
   * Tabs between fields are intentional.
   */
  const command =
    `DATA UPDATE USERINFO PIN=${pin}` +
    `\tName=${name}` +
    `\tPrivilege=0` +
    `\tGrp=${newGroup}`;

  return command;
}

// ------------------------------------------------------------
// QUEUE COMMAND
// ------------------------------------------------------------

async function queueCommand(
  identity: any,
  member: any,
  device: any,
  commandString: string
) {
  console.log('\n📤 Creating ADMS command...');
  const targetGroup = /Grp=(\d+)/i.exec(commandString)?.[1];
  if (!targetGroup) throw new Error('Command is missing a valid Grp value.');

  const [existingCommand] = await db
    .select()
    .from(biometricDeviceCommands)
    .where(and(
      eq(biometricDeviceCommands.deviceId, device.id),
      sql`${biometricDeviceCommands.status} IN ('PENDING', 'SENT')`,
      sql`${biometricDeviceCommands.commandString} LIKE ${`%PIN=${identity.deviceUserId}%`}`,
      sql`${biometricDeviceCommands.commandString} LIKE ${`%Grp=${targetGroup}%`}`,
    ))
    .orderBy(biometricDeviceCommands.createdAt)
    .limit(1);

  if (existingCommand) {
    console.log('✓ Existing active command found; reusing it instead of creating a duplicate.');
    console.log('  Command ID:', existingCommand.id);
    return existingCommand;
  }

  const [conflictingCommand] = await db
    .select({ id: biometricDeviceCommands.id, commandString: biometricDeviceCommands.commandString })
    .from(biometricDeviceCommands)
    .where(and(
      eq(biometricDeviceCommands.deviceId, device.id),
      sql`${biometricDeviceCommands.status} IN ('PENDING', 'SENT')`,
      sql`${biometricDeviceCommands.commandString} LIKE ${`%PIN=${identity.deviceUserId}%`}`,
    ))
    .limit(1);

  if (conflictingCommand) {
    throw new Error(`A different active command already exists for PIN ${identity.deviceUserId}: ${conflictingCommand.id}`);
  }

  const [command] = await db
    .insert(biometricDeviceCommands)
    .values({
      organizationId: member.organizationId,
      deviceId: device.id,
      deviceSerial: device.serialNumber,
      commandString,
      status: 'PENDING',
    })
    .returning();

  if (!command) {
    throw new Error(
      'Database did not return the created command.'
    );
  }

  await db.update(biometricIdentities)
    .set({ syncStatus: 'PENDING', updatedAt: new Date() })
    .where(eq(biometricIdentities.id, identity.id));

  console.log('✓ Command created');
  console.log('  Command ID:', command.id);
  console.log('  Device:', device.serialNumber);
  console.log('  Status:', command.status);

  return command;
}

// ------------------------------------------------------------
// WAIT FOR DEVICE
// ------------------------------------------------------------

async function waitForCommand(commandId: string) {
  console.log('\n⏳ Waiting for F09 to process command...');
  console.log(
    '   The ADMS /iclock/getrequest endpoint must deliver it.'
  );

  const start = Date.now();

  let lastStatus = '';

  while (Date.now() - start < TIMEOUT_MS) {
    const [command] = await db
      .select()
      .from(biometricDeviceCommands)
      .where(eq(biometricDeviceCommands.id, commandId))
      .limit(1);

    if (!command) {
      throw new Error(
        `Command ${commandId} no longer exists.`
      );
    }

    if (command.status !== lastStatus) {
      console.log('\n==============================');
      console.log('COMMAND STATUS CHANGED');
      console.log('ID:', command.id);
      console.log('Device:', command.deviceSerial);
      console.log('Status:', command.status);
      console.log('ADMS ID:', command.admsCommandId);
      console.log('Sent At:', command.sentAt);
      console.log('Completed At:', command.completedAt);
      console.log('==============================\n');

      lastStatus = command.status;
    } else {
      process.stdout.write('.');
    }

    // --------------------------------------------------------
    // DEVICE RECEIVED AND CONFIRMED
    // --------------------------------------------------------

    if (command.status === 'COMPLETED') {
      console.log(
        '\n\n🎉 F09 CONFIRMED COMMAND!'
      );

      return command;
    }

    // --------------------------------------------------------
    // DEVICE REJECTED COMMAND
    // --------------------------------------------------------

    if (command.status === 'FAILED') {
      console.error(
        '\n\n❌ F09 FAILED THE COMMAND.'
      );

      console.error(
        'Command record:',
        command
      );

      return command;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timeout after ${TIMEOUT_MS / 1000}s. ` +
    `Command ${commandId} is still PENDING/SENT.`
  );
}

// ------------------------------------------------------------
// UPDATE LOCAL DATABASE AFTER SUCCESS
// ------------------------------------------------------------

async function markIdentitySynced(
  identityId: string,
  newGroup: number
) {
  console.log(
    `\n💾 Updating local identity to Group ${newGroup}...`
  );

  await db
    .update(biometricIdentities)
    .set({
      accessGroup: newGroup,
      syncStatus: 'SYNCED',
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(biometricIdentities.id, identityId));

  console.log('✓ Local identity synchronized');
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

async function main() {
  console.log('');
  console.log('================================================');
  console.log('       ZKTECO F09 USER GROUP TOGGLE');
  console.log('================================================');
  console.log('');

  console.log('PIN:', PIN);
  console.log('Group A:', GROUP_A);
  console.log('Group B:', GROUP_B);
  console.log('');

  // ----------------------------------------------------------
  // 1. FETCH IDENTITY
  // ----------------------------------------------------------

  const identity = await fetchUserByPin(PIN);

  // ----------------------------------------------------------
  // 2. FETCH MEMBER
  // ----------------------------------------------------------

  const member = await fetchMember(identity.memberId);

  // ----------------------------------------------------------
  // 3. FETCH DEVICE
  // ----------------------------------------------------------

  const device = await fetchDevice(identity.deviceId);

  // ----------------------------------------------------------
  // 4. HEALTH CHECK
  // ----------------------------------------------------------

  checkDeviceHealth(device);

  // ----------------------------------------------------------
  // 5. CALCULATE TOGGLE
  // ----------------------------------------------------------

  const currentGroup = normalizeGroup(
    identity.accessGroup
  );

  const newGroup =
    calculateNextGroup(currentGroup);

  console.log('\n🔄 GROUP TOGGLE');
  console.log('  Current:', currentGroup);
  console.log('  New:', newGroup);

  // ----------------------------------------------------------
  // 6. BUILD ZKTECO COMMAND
  // ----------------------------------------------------------

  const commandString =
    buildCommand(
      PIN,
      member,
      newGroup
    );

  console.log('\n📋 COMMAND');
  console.log('  Raw command:');
  console.log(commandString);

  console.log('\n  JSON representation:');
  console.log(JSON.stringify(commandString));

  // ----------------------------------------------------------
  // 7. QUEUE COMMAND
  // ----------------------------------------------------------

  const command =
    await queueCommand(
      identity,
      member,
      device,
      commandString
    );

  // ----------------------------------------------------------
  // 8. WAIT FOR DEVICE
  // ----------------------------------------------------------

  try {
    const result =
      await waitForCommand(command.id);

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    if (result.status === 'COMPLETED') {
      await markIdentitySynced(
        identity.id,
        newGroup
      );

      console.log('');
      console.log('================================================');
      console.log('                    SUCCESS');
      console.log('================================================');
      console.log(
        `PIN ${PIN}: Group ${currentGroup} -> ${newGroup}`
      );
      console.log(
        `Device: ${device.serialNumber}`
      );
      console.log('');
      return;
    }

    // --------------------------------------------------------
    // FAILED
    // --------------------------------------------------------

    if (result.status === 'FAILED') {
      console.error('');
      console.error('================================================');
      console.error('                    FAILED');
      console.error('================================================');
      console.error(
        `PIN ${PIN} was NOT changed locally.`
      );
      throw new Error(`F09 rejected the command. Return code is recorded on ${result.id}.`);
    }
  } catch (error: any) {
    console.error('');
    console.error('================================================');
    console.error('                  TIMEOUT');
    console.error('================================================');

    console.error(error.message);

    console.error('');
    console.error(
      'The command is still waiting for ADMS delivery.'
    );

    console.error('');
    console.error(
      'Check the F09 /iclock/getrequest endpoint.'
    );

    console.error('');
    console.error(
      `Command ID: ${command.id}`
    );

    console.error(
      `Device SN: ${device.serialNumber}`
    );

    console.error('');
    return;
  }
}

// ------------------------------------------------------------
// RUN
// ------------------------------------------------------------

main()
  .catch(error => {
    console.error('\n❌ SCRIPT ERROR');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
