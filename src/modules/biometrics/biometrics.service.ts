import { db } from '../../db/index';
import { biometricDevices, biometricEvents, biometricIdentities, biometricDeviceCommands } from '../../db/schema/biometrics.schema';
import { attendanceLogs } from '../../db/schema/attendance.schema';
import { members } from '../../db/schema/members.schema';
import { memberMemberships } from '../../db/schema/memberships.schema';
import { organizations } from '../../db/schema/org.schema';
import { eq, and, desc, asc, ne, isNull, sql, lt } from 'drizzle-orm';
import { createLogger } from '../../common/logger/index';
import crypto from 'crypto';
import { AppError, ErrorCode } from '../../common/errors/AppError';

const log = createLogger('biometrics-service');

// ZKTeco F09 access groups used by GymFlow.
export const BIOMETRIC_ACCESS_GROUP_ALLOWED = 1;
export const BIOMETRIC_ACCESS_GROUP_DENIED = 99;

export function currentDateInTimeZone(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Calculates whether a member should be in Access Group 1 (Active/Allowed) or Group 99 (Denied).
 * Group 1: Member status is ACTIVE AND member has at least one active membership with endDate >= today.
 * Group 99: All other statuses (EXPIRED, FROZEN, INACTIVE, ARCHIVED, CANCELLED) or no active membership.
 */
export async function calculateMemberAccessGroup(orgId: string, memberId: string, tx: any = db): Promise<number> {
  const [member] = await tx
    .select({
      id: members.id,
      status: members.status,
      deletedAt: members.deletedAt,
      orgTimezone: organizations.timezone,
    })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(and(eq(members.id, memberId), eq(members.organizationId, orgId)))
    .limit(1);

  if (!member || member.deletedAt || member.status !== 'ACTIVE') {
    return BIOMETRIC_ACCESS_GROUP_DENIED;
  }

  const todayStr = currentDateInTimeZone(member.orgTimezone || 'Asia/Kolkata');

  // Check if member has at least one ACTIVE membership that hasn't expired
  const [activePlan] = await tx
    .select({ id: memberMemberships.id })
    .from(memberMemberships)
    .where(and(
      eq(memberMemberships.memberId, memberId),
      eq(memberMemberships.status, 'ACTIVE'),
      sql`${memberMemberships.endDate} >= ${todayStr}`
    ))
    .limit(1);

  return activePlan ? BIOMETRIC_ACCESS_GROUP_ALLOWED : BIOMETRIC_ACCESS_GROUP_DENIED;
}

export async function processAdmsAttendance(
  deviceSn: string,
  rawPayload: string,
) {
  const [device] = await db
    .select()
    .from(biometricDevices)
    .where(eq(biometricDevices.serialNumber, deviceSn))
    .limit(1);

  if (!device) {
    log.warn({ deviceSn }, 'Received ADMS data from unknown device');
    return;
  }

  await db.update(biometricDevices)
    .set({ lastSeenAt: new Date(), status: 'ONLINE', updatedAt: new Date() })
    .where(eq(biometricDevices.id, device.id));

  const lines = rawPayload.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 4 || !parts[0] || !parts[1]) continue;

    const pin = parts[0];
    const timeStr = parts[1];
    const status = parts[2];
    const verify = parts[3];

    const eventTime = new Date(timeStr);
    const eventHash = crypto.createHash('sha256').update(`${deviceSn}:${pin}:${timeStr}`).digest('hex');

    const [existingEvent] = await db.select({ id: biometricEvents.id })
      .from(biometricEvents).where(eq(biometricEvents.eventHash, eventHash)).limit(1);
    
    if (existingEvent) continue;

    const [identity] = await db
      .select({ memberId: biometricIdentities.memberId })
      .from(biometricIdentities)
      .where(and(
        eq(biometricIdentities.deviceId, device.id),
        eq(biometricIdentities.deviceUserId, pin)
      ))
      .limit(1);

    let verifyMethod: any = 'UNKNOWN';
    if (verify === '15') verifyMethod = 'FACE';
    else if (verify === '1') verifyMethod = 'FINGERPRINT';
    else if (verify === '0') verifyMethod = 'PASSWORD';
    else if (verify === '4') verifyMethod = 'CARD';

    const [event] = await db.insert(biometricEvents).values({
      organizationId: device.organizationId,
      branchId: device.branchId,
      deviceId: device.id,
      deviceSerial: deviceSn,
      memberId: identity?.memberId ?? null,
      deviceUserId: pin,
      eventTime,
      eventType: status === '0' ? 'CHECK_IN' : status === '1' ? 'CHECK_OUT' : 'UNKNOWN',
      verifyMethod,
      rawPayload: trimmed,
      eventHash,
    }).returning();

    if (identity?.memberId && event) {
      try {
        const [member] = await db.select({ firstName: members.firstName, lastName: members.lastName }).from(members).where(eq(members.id, identity.memberId)).limit(1);
        
        if (member) {
          // Check if they are currently inside (i.e., have an active session with no checkOutAt)
          const [activeLog] = await db.select().from(attendanceLogs)
            .where(and(
              eq(attendanceLogs.memberId, identity.memberId),
              isNull(attendanceLogs.checkOutAt)
            ))
            .orderBy(desc(attendanceLogs.checkInAt))
            .limit(1);

          if (activeLog) {
            // Already checked in. Treat punch as Check Out (cooldown 1 minute to avoid double-swipe)
            const oneMinute = 60 * 1000;
            if (eventTime.getTime() - activeLog.checkInAt.getTime() > oneMinute) {
              await db.update(attendanceLogs)
                .set({ checkOutAt: eventTime, checkOutMethod: 'AUTO' })
                .where(eq(attendanceLogs.id, activeLog.id));
              log.info({ memberId: identity.memberId, eventId: event.id }, 'Processed biometric check-out');
            }
          } else {
            // Not checked in. Treat punch as Check In.
            // Check last checkout to avoid spam (cooldown 1 minute)
            const [lastLog] = await db.select().from(attendanceLogs)
              .where(eq(attendanceLogs.memberId, identity.memberId))
              .orderBy(desc(attendanceLogs.checkInAt))
              .limit(1);
            
            const lastTime = lastLog?.checkOutAt || lastLog?.checkInAt;
            const oneMinute = 60 * 1000;
            
            if (!lastTime || (eventTime.getTime() - lastTime.getTime() > oneMinute)) {
              await db.insert(attendanceLogs).values({
                organizationId: device.organizationId,
                branchId: device.branchId,
                memberId: identity.memberId,
                memberName: `${member.firstName} ${member.lastName}`,
                checkInAt: eventTime,
                checkInMethod: 'BIOMETRIC',
                biometricEventId: event.id,
              });
              log.info({ memberId: identity.memberId, eventId: event.id }, 'Processed biometric check-in');
            }
          }
        }
      } catch (err) {
        log.error({ err, eventId: event.id }, 'Failed to create attendance log for biometric event');
      }
    }
  }
}

// ADMS Commands Queue

// Helper to get next ADMS numeric ID using a Postgres sequence
async function getNextAdmsCommandId(): Promise<number> {
  // Older installations may have applied the adms_command_id column migration
  // before the sequence was added. Keep command delivery self-healing and safe
  // for those databases; the migration also creates this sequence for new ones.
  await db.execute(sql`
    CREATE SEQUENCE IF NOT EXISTS biometric_adms_command_id_seq
  `);
  const result = await db.execute(sql`
    SELECT nextval('biometric_adms_command_id_seq') AS id
  `);
  return Number((result as any[])[0]?.id);
}

export async function processAdmsGetRequest(
  serialNumber: string
): Promise<string> {
  const sn = String(serialNumber).trim();

  console.log('\n========================================');
  console.log('[ADMS GETREQUEST]');
  console.log('Device SN:', sn);
  console.log('========================================');

  // Also update lastSeenAt to keep device ONLINE (added back for safety)
  await db.update(biometricDevices)
    .set({ lastSeenAt: new Date(), status: 'ONLINE', updatedAt: new Date() })
    .where(eq(biometricDevices.serialNumber, sn));

  // ----------------------------------------------------------
  // 1. Find pending command for THIS exact device
  // ----------------------------------------------------------

  const [command] = await db
    .select()
    .from(biometricDeviceCommands)
    .where(
      and(
        eq(
          biometricDeviceCommands.deviceSerial,
          sn
        ),
        eq(
          biometricDeviceCommands.status,
          'PENDING'
        )
      )
    )
    .orderBy(
      asc(biometricDeviceCommands.createdAt)
    )
    .limit(1);

  if (!command) {
    console.log(
      `[ADMS GETREQUEST] No PENDING command for ${sn}`
    );

    return 'OK';
  }

  console.log(
    '[ADMS GETREQUEST] Found command:',
    command.id
  );

  console.log(
    '[ADMS GETREQUEST] Command:',
    command.commandString
  );

  // ----------------------------------------------------------
  // 2. Generate numeric ADMS ID
  // ----------------------------------------------------------

  const admsCommandId = await getNextAdmsCommandId();

  console.log(
    '[ADMS GETREQUEST] ADMS ID:',
    admsCommandId
  );

  // ----------------------------------------------------------
  // 3. IMPORTANT:
  // Update the command atomically.
  // ----------------------------------------------------------

  const [updated] = await db
    .update(biometricDeviceCommands)
    .set({
      admsCommandId,
      status: 'SENT',
      sentAt: new Date(),
    })
    .where(
      and(
        eq(
          biometricDeviceCommands.id,
          command.id
        ),
        eq(
          biometricDeviceCommands.status,
          'PENDING'
        )
      )
    )
    .returning();

  if (!updated) {
    console.warn(
      '[ADMS GETREQUEST] Command was already claimed.'
    );

    return 'OK';
  }

  // ----------------------------------------------------------
  // 4. Build exact ZKTeco response
  // ----------------------------------------------------------

  const response =
    `C:${admsCommandId}:${command.commandString}\n`;

  console.log(
    '[ADMS GETREQUEST] Sending:'
  );

  console.log(
    JSON.stringify(response)
  );

  console.log(
    '[ADMS GETREQUEST] DB UUID:',
    command.id
  );

  console.log(
    '[ADMS GETREQUEST] ADMS ID:',
    admsCommandId
  );

  console.log(
    '[ADMS GETREQUEST] Status: SENT'
  );

  return response;
}

export async function processAdmsDeviceCmd(deviceSn: string, payload: string) {
  log.info({ deviceSn, payload }, 'Received ADMS devicecmd payload');
  if (!payload) return;

  const lines = payload.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let cmdId: string | null = null;
    let returnCode: string | null = null;

    if (trimmed.includes('&')) {
      const params = new URLSearchParams(trimmed);
      cmdId = params.get('ID');
      returnCode = params.get('Return');
    } else if (trimmed.includes('=')) {
      const parts = trimmed.split(/[\t\s]+/);
      for (const part of parts) {
        const [k, v] = part.split('=');
        if (k === 'ID' && v) cmdId = v;
        if (k === 'Return' && v) returnCode = v;
      }
    } else if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      if (parts[0] === 'ID' && parts[1]) cmdId = parts[1];
    }

    if (!cmdId) {
      const idMatch = trimmed.match(/ID=([a-f0-9-]+)/i);
      const retMatch = trimmed.match(/Return=(-?[0-9]+)/i);
      if (idMatch && idMatch[1]) cmdId = idMatch[1];
      if (retMatch && retMatch[1]) returnCode = retMatch[1];
    }

    if (cmdId) {
      const isSuccess = returnCode === '0' || returnCode === null;
      const status = isSuccess ? 'COMPLETED' : 'FAILED';
      
      const [device] = await db.select({ id: biometricDevices.id }).from(biometricDevices).where(eq(biometricDevices.serialNumber, deviceSn)).limit(1);
      if (!device) continue;

      const admsCommandId = Number(cmdId);
      if (isNaN(admsCommandId)) {
        log.warn({ cmdId }, 'Received non-numeric command ID from device');
        continue;
      }

      const [updatedCmd] = await db.update(biometricDeviceCommands)
        .set({ status, completedAt: new Date() })
        .where(and(
          eq(biometricDeviceCommands.admsCommandId, admsCommandId),
          eq(biometricDeviceCommands.deviceId, device.id)
        ))
        .returning();

      // If we can extract the PIN and Group from the commandString, update biometricIdentities
      if (updatedCmd && updatedCmd.commandString) {
        const pinMatch = updatedCmd.commandString.match(/PIN=(\w+)/i);
        const grpMatch = updatedCmd.commandString.match(/Grp=(\d+)/i) || updatedCmd.commandString.match(/Group=(\d+)/i);
        const targetGrp = grpMatch && grpMatch[1] ? parseInt(grpMatch[1], 10) : undefined;

        if (pinMatch && pinMatch[1]) {
          const pin = pinMatch[1];
          const updateData: any = {
            syncStatus: isSuccess ? 'SYNCED' : 'FAILED',
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          };
          if (targetGrp !== undefined && isSuccess) {
            updateData.accessGroup = targetGrp;
          }

          await db.update(biometricIdentities)
            .set(updateData)
            .where(and(
              eq(biometricIdentities.deviceId, updatedCmd.deviceId),
              eq(biometricIdentities.deviceUserId, pin)
            ));
        }
      }
    }
  }
}

// Service methods for WebApp UI

export async function listDevicesService(orgId: string) {
  return db.select().from(biometricDevices).where(eq(biometricDevices.organizationId, orgId)).orderBy(desc(biometricDevices.createdAt));
}

export async function listIdentitiesService(orgId: string) {
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const todayStr = currentDateInTimeZone(org?.timezone || 'Asia/Kolkata');

  const rows = await db.select({
    id: biometricIdentities.id,
    memberId: biometricIdentities.memberId,
    memberName: sql<string>`concat(${members.firstName}, ' ', ${members.lastName})`.as('member_name'),
    memberNumber: members.memberNumber,
    memberStatus: members.status,
    deletedAt: members.deletedAt,
    deviceId: biometricIdentities.deviceId,
    deviceName: biometricDevices.deviceName,
    deviceSerial: biometricDevices.serialNumber,
    deviceUserId: biometricIdentities.deviceUserId,
    storedAccessGroup: biometricIdentities.accessGroup,
    syncStatus: biometricIdentities.syncStatus,
    lastSyncedAt: biometricIdentities.lastSyncedAt,
    createdAt: biometricIdentities.createdAt,
    hasActivePlan: sql<boolean>`EXISTS (
      SELECT 1 FROM ${memberMemberships}
      WHERE ${memberMemberships.memberId} = ${members.id}
        AND ${memberMemberships.status} = 'ACTIVE'
        AND ${memberMemberships.endDate} >= ${todayStr}
    )`.as('has_active_plan'),
  }).from(biometricIdentities)
    .innerJoin(members, eq(members.id, biometricIdentities.memberId))
    .innerJoin(biometricDevices, eq(biometricDevices.id, biometricIdentities.deviceId))
    .where(eq(members.organizationId, orgId))
    .orderBy(desc(biometricIdentities.createdAt));

  return rows.map(r => {
    const isMemberActive = !r.deletedAt && r.memberStatus === 'ACTIVE' && r.hasActivePlan;
    const computedGroup = isMemberActive
      ? BIOMETRIC_ACCESS_GROUP_ALLOWED
      : BIOMETRIC_ACCESS_GROUP_DENIED;
    return {
      id: r.id,
      memberId: r.memberId,
      memberName: r.memberName,
      memberNumber: r.memberNumber,
      memberStatus: r.memberStatus,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      deviceSerial: r.deviceSerial,
      deviceUserId: r.deviceUserId,
      accessGroup: computedGroup, // Real-time calculated: 1 for active, 99 for expired/inactive
      syncStatus: (r.storedAccessGroup !== computedGroup && r.syncStatus === 'SYNCED') ? 'PENDING' : r.syncStatus,
      lastSyncedAt: r.lastSyncedAt,
      createdAt: r.createdAt,
    };
  });
}

export async function registerDeviceService(orgId: string, data: { branchId: string; serialNumber: string; deviceName: string; deviceType?: string; purpose?: any }) {
  const [device] = await db.insert(biometricDevices).values({
    organizationId: orgId,
    branchId: data.branchId,
    serialNumber: data.serialNumber,
    deviceName: data.deviceName,
    deviceType: data.deviceType,
    purpose: data.purpose || 'OTHER',
  }).returning();
  return device;
}

export async function deleteDeviceService(orgId: string, deviceId: string) {
  const [device] = await db.delete(biometricDevices).where(and(eq(biometricDevices.id, deviceId), eq(biometricDevices.organizationId, orgId))).returning();
  if (!device) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Device not found');
  return device;
}

/**
 * Syncs a single member's access group (Group 1 for active, Group 99 for denied) across all their branch devices.
 * Implements smart delta diffing: skips queuing duplicate commands if the device is already in the target group and SYNCED.
 */
export async function syncMemberBiometricAccessService(
  orgId: string,
  memberId: string,
  options?: { force?: boolean; explicitPin?: string; explicitName?: string; explicitGroup?: number }
) {
  const [member] = await db.select({
    id: members.id,
    branchId: members.branchId,
    memberNumber: members.memberNumber,
    firstName: members.firstName,
    lastName: members.lastName,
    status: members.status,
    deletedAt: members.deletedAt,
  }).from(members).where(and(eq(members.id, memberId), eq(members.organizationId, orgId))).limit(1);

  if (!member) {
    throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');
  }

  if (!member.branchId) {
    log.debug({ memberId }, 'Member has no branch assigned, skipping biometric sync');
    return { success: true, count: 0, reason: 'NO_BRANCH' };
  }

  // Find all biometric devices for this branch
  const devices = await db.select()
    .from(biometricDevices)
    .where(eq(biometricDevices.branchId, member.branchId));

  if (devices.length === 0) {
    log.debug({ memberId, branchId: member.branchId }, 'No biometric devices registered for member branch');
    return { success: true, count: 0, reason: 'NO_DEVICES' };
  }

  // Always calculate the group from current membership state. An explicit
  // group from a client could otherwise accidentally grant an inactive member
  // access by sending Grp=1.
  const calculatedGroup = await calculateMemberAccessGroup(orgId, memberId);
  // A caller may explicitly revoke access, but may never explicitly grant
  // group 1 to a member whose current state is not eligible.
  const targetGroup = options?.explicitGroup === BIOMETRIC_ACCESS_GROUP_DENIED
    ? BIOMETRIC_ACCESS_GROUP_DENIED
    : calculatedGroup;

  const pin = options?.explicitPin || member.memberNumber.replace(/\D/g, '') || member.id.slice(0, 8);
  const name = options?.explicitName || `${member.firstName} ${member.lastName}`.trim().substring(0, 24);

  let commandsQueued = 0;

  for (const device of devices) {
    // Check for conflict on this device with another member using the same PIN
    const [conflict] = await db.select().from(biometricIdentities)
      .where(and(
        eq(biometricIdentities.deviceId, device.id),
        eq(biometricIdentities.deviceUserId, pin),
        ne(biometricIdentities.memberId, memberId)
      )).limit(1);

    if (conflict) {
      log.warn({ memberId, pin, deviceName: device.deviceName }, 'PIN conflict detected on device');
      throw AppError.badRequest(ErrorCode.BAD_REQUEST, `PIN ${pin} is already assigned to another member on device ${device.deviceName}.`);
    }

    const [existingIdentity] = await db.select()
      .from(biometricIdentities)
      .where(and(
        eq(biometricIdentities.deviceId, device.id),
        eq(biometricIdentities.memberId, memberId)
      ))
      .limit(1);

    // Delta check: if already at target group and SYNCED, and no pending command, no change needed
    if (!options?.force && existingIdentity && existingIdentity.accessGroup === targetGroup && existingIdentity.syncStatus === 'SYNCED' && existingIdentity.deviceUserId === pin) {
      const [pendingCmd] = await db.select({ id: biometricDeviceCommands.id })
        .from(biometricDeviceCommands)
        .where(and(
          eq(biometricDeviceCommands.deviceId, device.id),
          eq(biometricDeviceCommands.status, 'PENDING'),
          sql`${biometricDeviceCommands.commandString} LIKE ${`%PIN=${pin}%`}`
        ))
        .limit(1);

      if (!pendingCmd) {
        log.debug({ memberId, deviceId: device.id, targetGroup }, 'Biometric device already in target access group, skipping redundant command');
        continue;
      }
    }

    // Cancel / supersede old pending/sent commands for this pin on this device
    await db.update(biometricDeviceCommands)
      .set({ status: 'FAILED', completedAt: new Date() })
      .where(and(
        eq(biometricDeviceCommands.deviceId, device.id),
        sql`${biometricDeviceCommands.status} IN ('PENDING', 'SENT')`,
        sql`${biometricDeviceCommands.commandString} LIKE ${`%PIN=${pin}%`}`
      ));

    // F09 ADMS dialect. This is the format used by the working F09 toggle
    // utility; this firmware rejects the shorter DATA UPDATE user / Group form.
    const commandString = `DATA UPDATE USERINFO PIN=${pin}\tName=${name}\tPrivilege=0\tGrp=${targetGroup}`;
    await db.insert(biometricDeviceCommands).values({
      organizationId: orgId,
      deviceId: device.id,
      deviceSerial: device.serialNumber,
      commandString,
      status: 'PENDING',
    });

    if (existingIdentity) {
      await db.update(biometricIdentities)
        .set({
          deviceUserId: pin,
          accessGroup: targetGroup,
          syncStatus: 'PENDING',
          updatedAt: new Date(),
        })
        .where(eq(biometricIdentities.id, existingIdentity.id));
    } else {
      await db.insert(biometricIdentities).values({
        memberId,
        deviceId: device.id,
        deviceUserId: pin,
        accessGroup: targetGroup,
        syncStatus: 'PENDING',
      });
    }

    commandsQueued++;
  }

  log.info({ memberId, targetGroup, commandsQueued }, 'Member biometric access synced');
  return { success: true, targetGroup, count: commandsQueued };
}

/**
 * Reconciles biometric access control for all members in the organization (or a specific branch).
 * Evaluates each member's target group (1 vs 99), performs delta diffing, and queues updates for out-of-sync devices.
 */
export async function reconcileBiometricAccessService(orgId: string, branchId?: string | null) {
  const branchConditions: any[] = [eq(biometricDevices.organizationId, orgId)];
  if (branchId) branchConditions.push(eq(biometricDevices.branchId, branchId));

  const devices = await db.select().from(biometricDevices).where(and(...branchConditions));
  if (devices.length === 0) {
    return {
      totalMembersChecked: 0,
      devicesCount: 0,
      commandsQueued: 0,
      group1ActiveCount: 0,
      group99DeniedCount: 0,
      alreadyInSyncCount: 0,
    };
  }

  const memberConditions: any[] = [
    eq(members.organizationId, orgId),
  ];
  if (branchId) memberConditions.push(eq(members.branchId, branchId));

  const allMembers = await db.select({
    id: members.id,
    branchId: members.branchId,
    memberNumber: members.memberNumber,
    firstName: members.firstName,
    lastName: members.lastName,
    status: members.status,
  }).from(members).where(and(...memberConditions));

  const totalMembersChecked = allMembers.length;
  let commandsQueued = 0;
  let group1ActiveCount = 0;
  let group99DeniedCount = 0;
  let alreadyInSyncCount = 0;

  for (const m of allMembers) {
    if (!m.branchId) continue;
    const targetGroup = await calculateMemberAccessGroup(orgId, m.id);
    if (targetGroup === 1) group1ActiveCount++;
    else group99DeniedCount++;

    // Reconciliation is idempotent. Only queue when the device is not already
    // confirmed in the calculated target group.
    const result = await syncMemberBiometricAccessService(orgId, m.id, { explicitGroup: targetGroup });
    if (result.count > 0) {
      commandsQueued += result.count;
    } else {
      alreadyInSyncCount++;
    }
  }

  return {
    totalMembersChecked,
    devicesCount: devices.length,
    commandsQueued,
    group1ActiveCount,
    group99DeniedCount,
    alreadyInSyncCount,
  };
}

// Manual Sync Member to Devices (UI invocation)
export async function syncMemberToBiometricsService(
  orgId: string,
  branchId: string,
  memberId: string,
  pin: string,
  name: string,
  accessGroup?: number
) {
  return syncMemberBiometricAccessService(orgId, memberId, {
    force: true,
    explicitPin: pin,
    explicitName: name,
    explicitGroup: accessGroup,
  });
}
