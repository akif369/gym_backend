import { db } from '../../db/index';
import { biometricDevices, biometricEvents, biometricIdentities, biometricDeviceCommands, deviceAccessStates } from '../../db/schema/biometrics.schema';
import { attendanceLogs } from '../../db/schema/attendance.schema';
import { members } from '../../db/schema/members.schema';
import { memberMemberships } from '../../db/schema/memberships.schema';
import { organizations, branches } from '../../db/schema/org.schema';
import { eq, and, desc, asc, isNull, sql, lt, inArray, lte } from 'drizzle-orm';
import { createLogger } from '../../common/logger/index';
import crypto from 'crypto';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { getMemberAccessStatusService } from '../members/members.service';
import { pinsConflict, resolveBiometricPin } from './biometric-pin';

const log = createLogger('biometrics-service');

// ZKTeco F09 access groups used by GYMatrix.
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
 * Group 1: Member status is ACTIVE and one membership is inside its exact UTC
 * access window. Group 99 is the physical-device representation of denial.
 * Group 99: All other statuses (EXPIRED, FROZEN, INACTIVE, ARCHIVED, CANCELLED) or no active membership.
 */
import { TenantContext, tenantWhere, accessibleBranchesWhere, assertBranchAccess } from '../../common/auth/tenant';

export async function calculateMemberAccessGroup(ctx: TenantContext, memberId: string, tx: any = db): Promise<number> {
  const status = await getMemberAccessStatusService(ctx, memberId, tx);
  return status.allowed ? BIOMETRIC_ACCESS_GROUP_ALLOWED : BIOMETRIC_ACCESS_GROUP_DENIED;
}

/**
 * Persist the desired physical access group in the same transaction as a
 * membership mutation. It never waits for an F09 device or ADMS response.
 */
export async function recordMemberBiometricAccessIntent(
  ctx: TenantContext,
  memberId: string,
  desiredGroup: number,
  tx: any = db,
) {
  const [member] = await tx.select({ id: members.id, branchId: members.branchId })
    .from(members)
    .where(and(eq(members.id, memberId), tenantWhere(members, ctx)))
    .limit(1);
  if (!member) return { statesRecorded: 0 };

  const branchDevices = member.branchId
    ? await tx.select().from(biometricDevices).where(and(eq(biometricDevices.branchId, member.branchId), tenantWhere(biometricDevices, ctx)))
    : [];
  const existingIdentities = await tx.select({ deviceId: biometricIdentities.deviceId })
    .from(biometricIdentities)
    .where(eq(biometricIdentities.memberId, memberId));
  const priorDevices = existingIdentities.length > 0
    ? await tx.select().from(biometricDevices).where(inArray(biometricDevices.id, existingIdentities.map((identity: any) => identity.deviceId)))
    : [];
  const allDevices = branchDevices.length > 0
    ? [...branchDevices, ...priorDevices]
    : await tx.select().from(biometricDevices).where(tenantWhere(biometricDevices, ctx));
  const devices = [...new Map<string, any>(allDevices.map((device: any) => [device.id, device])).values()];

  for (const device of devices) {
    await tx.insert(deviceAccessStates).values({
      organizationId: ctx.organizationId,
      branchId: device.branchId,
      deviceId: device.id,
      memberId,
      desiredGroup,
      status: 'PENDING',
      nextAttemptAt: new Date(),
      lastDesiredAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [deviceAccessStates.deviceId, deviceAccessStates.memberId],
      set: {
        desiredGroup,
        desiredVersion: sql`${deviceAccessStates.desiredVersion} + 1`,
        status: 'PENDING',
        nextAttemptAt: new Date(),
        lastError: null,
        lastDesiredAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
  return { statesRecorded: devices.length };
}

const retryDelayMs = (attempt: number) => Math.min(15 * 60_000, [10_000, 30_000, 60_000, 120_000, 300_000][Math.min(attempt, 4)] ?? 900_000);

/** Requeue ADMS deliveries that were sent but not acknowledged before timeout. */
export async function recoverStaleDeviceAccessStates() {
  const stale = await db.select().from(deviceAccessStates)
    .where(and(eq(deviceAccessStates.status, 'SENT'), lte(deviceAccessStates.nextAttemptAt, new Date())))
    .limit(100);
  for (const state of stale) {
    await db.transaction(async (tx) => {
      await tx.update(biometricDeviceCommands)
        .set({ status: 'FAILED', completedAt: new Date() })
        .where(and(eq(biometricDeviceCommands.accessStateId, state.id), eq(biometricDeviceCommands.desiredVersion, state.desiredVersion), eq(biometricDeviceCommands.status, 'SENT')));
      await tx.update(deviceAccessStates)
        .set({ status: 'PENDING', nextAttemptAt: new Date(Date.now() + retryDelayMs(state.attemptCount)), lastError: 'ADMS acknowledgement timeout', updatedAt: new Date() })
        .where(and(eq(deviceAccessStates.id, state.id), eq(deviceAccessStates.status, 'SENT'), eq(deviceAccessStates.desiredVersion, state.desiredVersion)));
    });
  }
  return { recovered: stale.length };
}

/**
 * Converts durable desired states into at most one ADMS command per device per
 * run. This prevents an expiry burst from flooding an F09 controller.
 */
export async function queuePendingDeviceAccessCommands(limit = 100) {
  const pending = await db.select({ state: deviceAccessStates, device: biometricDevices, member: members })
    .from(deviceAccessStates)
    .innerJoin(biometricDevices, eq(biometricDevices.id, deviceAccessStates.deviceId))
    .innerJoin(members, eq(members.id, deviceAccessStates.memberId))
    .where(and(eq(deviceAccessStates.status, 'PENDING'), lte(deviceAccessStates.nextAttemptAt, new Date()), isNull(members.deletedAt)))
    .orderBy(asc(deviceAccessStates.nextAttemptAt))
    .limit(limit);
  const claimedDevices = new Set<string>();
  let queued = 0;

  for (const { state, device, member } of pending) {
    if (claimedDevices.has(device.id)) continue;
    claimedDevices.add(device.id);
    await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(deviceAccessStates).where(eq(deviceAccessStates.id, state.id)).limit(1).for('update');
      if (!fresh || fresh.status !== 'PENDING' || fresh.desiredVersion !== state.desiredVersion) return;
      const pin = resolveBiometricPin(undefined, member.memberNumber);
      if (!pin) {
        await tx.update(deviceAccessStates).set({ status: 'FAILED', lastError: 'Member has no valid numeric biometric PIN', nextAttemptAt: new Date(Date.now() + 15 * 60_000), updatedAt: new Date() }).where(eq(deviceAccessStates.id, fresh.id));
        return;
      }
      const [identity] = await tx.select().from(biometricIdentities)
        .where(and(eq(biometricIdentities.deviceId, device.id), eq(biometricIdentities.memberId, member.id)))
        .limit(1);
      if (identity) {
        await tx.update(biometricIdentities).set({ deviceUserId: pin, syncStatus: 'PENDING', updatedAt: new Date() }).where(eq(biometricIdentities.id, identity.id));
      } else {
        await tx.insert(biometricIdentities).values({ organizationId: device.organizationId, branchId: device.branchId, memberId: member.id, deviceId: device.id, deviceUserId: pin, accessGroup: BIOMETRIC_ACCESS_GROUP_DENIED, syncStatus: 'PENDING' });
      }
      const name = `${member.firstName} ${member.lastName}`.trim().substring(0, 24);
      await tx.insert(biometricDeviceCommands).values({
        organizationId: device.organizationId,
        branchId: device.branchId,
        deviceId: device.id,
        deviceSerial: device.serialNumber,
        accessStateId: fresh.id,
        desiredVersion: fresh.desiredVersion,
        commandString: `DATA UPDATE USERINFO PIN=${pin}\tName=${name}\tPrivilege=0\tGrp=${fresh.desiredGroup}`,
        status: 'PENDING',
      });
      await tx.update(deviceAccessStates).set({
        status: 'SENT',
        attemptCount: fresh.attemptCount + 1,
        nextAttemptAt: new Date(Date.now() + 2 * 60_000),
        updatedAt: new Date(),
      }).where(and(eq(deviceAccessStates.id, fresh.id), eq(deviceAccessStates.desiredVersion, fresh.desiredVersion)));
      queued += 1;
    });
  }
  return { queued };
}

export async function runDeviceAccessSyncWorker() {
  const recovered = await recoverStaleDeviceAccessStates();
  const queued = await queuePendingDeviceAccessCommands();
  return { ...recovered, ...queued };
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
    if (isNaN(eventTime.getTime())) {
      log.warn({ deviceSn, pin, timeStr }, 'Invalid event time received from device');
      continue;
    }

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

      const [state] = updatedCmd?.accessStateId && updatedCmd.desiredVersion !== null
        ? await db.select().from(deviceAccessStates).where(eq(deviceAccessStates.id, updatedCmd.accessStateId)).limit(1)
        : [undefined];
      // Never let a late command mutate the identity projection after a newer
      // desired version was committed.
      const isCurrentDesiredState = !updatedCmd?.accessStateId
        || (state && state.desiredVersion === updatedCmd.desiredVersion);

      // If we can extract the PIN and Group from the commandString, update biometricIdentities
      if (updatedCmd && isCurrentDesiredState && updatedCmd.commandString) {
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

      // Only acknowledge the currently desired version. A late response for an
      // older Group 99 command must never overwrite a newer Group 1 intent.
      if (updatedCmd?.accessStateId && updatedCmd.desiredVersion !== null) {
        if (state && state.desiredVersion === updatedCmd.desiredVersion) {
          if (isSuccess) {
            await db.update(deviceAccessStates).set({
              appliedGroup: state.desiredGroup,
              appliedVersion: updatedCmd.desiredVersion,
              status: 'SYNCED',
              lastError: null,
              lastAppliedAt: new Date(),
              updatedAt: new Date(),
            }).where(and(eq(deviceAccessStates.id, state.id), eq(deviceAccessStates.desiredVersion, updatedCmd.desiredVersion)));
          } else {
            await db.update(deviceAccessStates).set({
              status: 'PENDING',
              lastError: `ADMS returned ${returnCode ?? 'an unknown error'}`,
              nextAttemptAt: new Date(Date.now() + retryDelayMs(state.attemptCount)),
              updatedAt: new Date(),
            }).where(and(eq(deviceAccessStates.id, state.id), eq(deviceAccessStates.desiredVersion, updatedCmd.desiredVersion)));
          }
        }
      }
    }
  }
}

// Service methods for WebApp UI

export async function listDevicesService(ctx: TenantContext) {
  return db.select().from(biometricDevices).where(and(tenantWhere(biometricDevices, ctx), accessibleBranchesWhere(biometricDevices, ctx))).orderBy(desc(biometricDevices.createdAt));
}

export async function listIdentitiesService(ctx: TenantContext) {
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
        AND ${memberMemberships.startAt} <= NOW()
        AND ${memberMemberships.expiresAt} > NOW()
    )`.as('has_active_plan'),
  }).from(biometricIdentities)
    .innerJoin(members, eq(members.id, biometricIdentities.memberId))
    .innerJoin(biometricDevices, eq(biometricDevices.id, biometricIdentities.deviceId))
    .where(and(tenantWhere(members, ctx), accessibleBranchesWhere(members, ctx)))
    .orderBy(desc(biometricIdentities.createdAt));

  return rows.map(r => {
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
      accessGroup: r.storedAccessGroup,
      syncStatus: r.syncStatus,
      lastSyncedAt: r.lastSyncedAt,
      createdAt: r.createdAt,
    };
  });
}

export async function registerDeviceService(ctx: TenantContext, data: { branchId: string; serialNumber: string; deviceName: string; deviceType?: string; purpose?: any }) {
  const branchId = data.branchId?.trim();
  const serialNumber = data.serialNumber?.trim();
  const deviceName = data.deviceName?.trim();

  if (!branchId || !serialNumber || !deviceName) {
    throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'Branch, serial number, and device name are required');
  }

  if (ctx.role !== 'SUPER_ADMIN' && ctx.role !== 'SYSTEM') {
    assertBranchAccess(ctx, branchId);
  }

  const [branch] = await db.select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.organizationId, ctx.organizationId)))
    .limit(1);
  if (!branch) {
    throw AppError.notFound(ErrorCode.BRANCH_NOT_FOUND, 'Branch not found');
  }

  const [existing] = await db.select({ id: biometricDevices.id })
    .from(biometricDevices)
    .where(eq(biometricDevices.serialNumber, serialNumber))
    .limit(1);
  if (existing) {
    throw AppError.conflict(ErrorCode.ALREADY_EXISTS, 'A biometric device with this serial number is already registered');
  }

  const [device] = await db.insert(biometricDevices).values({
    organizationId: ctx.organizationId,
    branchId,
    serialNumber,
    deviceName,
    deviceType: data.deviceType?.trim() || undefined,
    purpose: data.purpose || 'OTHER',
  }).returning();
  return device;
}

export async function deleteDeviceService(ctx: TenantContext, deviceId: string) {
  const [device] = await db.delete(biometricDevices).where(and(eq(biometricDevices.id, deviceId), tenantWhere(biometricDevices, ctx), accessibleBranchesWhere(biometricDevices, ctx))).returning();
  if (!device) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Device not found');
  return device;
}

/**
 * Syncs a single member's access group (Group 1 for active, Group 99 for denied) across all their branch devices.
 * Implements smart delta diffing: skips queuing duplicate commands if the device is already in the target group and SYNCED.
 */
export async function syncMemberBiometricAccessService(
  ctx: TenantContext,
  memberId: string,
  options?: { force?: boolean; explicitPin?: string; explicitName?: string; explicitGroup?: number; explicitBranchId?: string }
) {
  const [member] = await db.select({
    id: members.id,
    branchId: members.branchId,
    memberNumber: members.memberNumber,
    firstName: members.firstName,
    lastName: members.lastName,
    status: members.status,
    deletedAt: members.deletedAt,
  }).from(members).where(and(eq(members.id, memberId), tenantWhere(members, ctx))).limit(1);

  if (!member) {
    throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member not found');
  }

  const effectiveBranchId = options?.explicitBranchId || member.branchId;

  // Prefer devices on the member's branch; if none are registered there, use every org device
  // so new members still appear in Member Device Permissions & Identities.
  const branchDevices = effectiveBranchId ? await db.select()
    .from(biometricDevices)
    .where(eq(biometricDevices.branchId, effectiveBranchId)) : [];

  const orgDevices = branchDevices.length === 0
    ? await db.select().from(biometricDevices).where(tenantWhere(biometricDevices, ctx))
    : branchDevices;

  const existingIdentityRecords = await db.select({ deviceId: biometricIdentities.deviceId })
    .from(biometricIdentities)
    .where(eq(biometricIdentities.memberId, memberId));

  const existingDeviceIds = existingIdentityRecords.map(id => id.deviceId);
  const additionalDevices = existingDeviceIds.length > 0 ? await db.select()
    .from(biometricDevices)
    .where(inArray(biometricDevices.id, existingDeviceIds)) : [];

  const deviceMap = new Map<string, typeof orgDevices[0]>();
  for (const d of orgDevices) deviceMap.set(d.id, d);
  for (const d of additionalDevices) deviceMap.set(d.id, d);
  const devices = Array.from(deviceMap.values());

  if (devices.length === 0) {
    log.debug({ memberId }, 'No biometric devices found for member to sync');
    return { success: true, count: 0, reason: 'NO_DEVICES' as const };
  }

  const calculatedGroup = await calculateMemberAccessGroup(ctx, memberId);
  const targetGroup = options?.explicitGroup !== undefined
    ? options.explicitGroup
    : calculatedGroup;

  const pin = resolveBiometricPin(options?.explicitPin, member.memberNumber);
  if (!pin) {
    log.warn({ memberId, memberNumber: member.memberNumber }, 'Could not resolve a numeric biometric PIN');
    return { success: false, count: 0, reason: 'NO_PIN' as const };
  }
  const name = options?.explicitName || `${member.firstName} ${member.lastName}`.trim().substring(0, 24);
  const pinCommandMatch = `(^|[\\t ])PIN=${pin}(\\t|$)`;

  let commandsQueued = 0;

  for (const device of devices) {
    const deviceIdentities = await db.select().from(biometricIdentities)
      .where(eq(biometricIdentities.deviceId, device.id));

    const conflict = deviceIdentities.find(identity =>
      identity.memberId !== memberId && pinsConflict(identity.deviceUserId, pin)
    );

    if (conflict) {
      log.warn({ memberId, pin, deviceName: device.deviceName }, 'PIN conflict detected on device');
      throw AppError.badRequest(ErrorCode.BAD_REQUEST, `PIN ${pin} is already assigned to another member on device ${device.deviceName}.`);
    }

    const existingIdentity = deviceIdentities.find(identity => identity.memberId === memberId);

    // Delta check: if already at target group and SYNCED, and no pending command, no change needed
    if (!options?.force && existingIdentity && existingIdentity.accessGroup === targetGroup && existingIdentity.syncStatus === 'SYNCED' && resolveBiometricPin(existingIdentity.deviceUserId) === pin) {
      const [pendingCmd] = await db.select({ id: biometricDeviceCommands.id })
        .from(biometricDeviceCommands)
        .where(and(
          eq(biometricDeviceCommands.deviceId, device.id),
          eq(biometricDeviceCommands.status, 'PENDING'),
          sql`${biometricDeviceCommands.commandString} ~ ${pinCommandMatch}`
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
        sql`${biometricDeviceCommands.commandString} ~ ${pinCommandMatch}`
      ));

    // F09 ADMS dialect. This is the format used by the working F09 toggle
    // utility; this firmware rejects the shorter DATA UPDATE user / Group form.
    const commandString = `DATA UPDATE USERINFO PIN=${pin}\tName=${name}\tPrivilege=0\tGrp=${targetGroup}`;
    await db.insert(biometricDeviceCommands).values({
      organizationId: ctx.organizationId,
    branchId: device.branchId,
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
        organizationId: device.organizationId,
        branchId: device.branchId,
        memberId,
        deviceId: device.id,
        deviceUserId: pin,
        accessGroup: targetGroup,
        syncStatus: 'PENDING',
      });
    }

    commandsQueued++;
  }

  log.info({ memberId, targetGroup, commandsQueued, pin }, 'Member biometric access synced');
  return { success: true, targetGroup, count: commandsQueued, pin };
}

/**
 * Reconciles biometric access control for all members in the organization (or a specific branch).
 * Evaluates each member's target group (1 vs 99), performs delta diffing, and queues updates for out-of-sync devices.
 */
export async function reconcileBiometricAccessService(ctx: TenantContext, branchId?: string | null) {
  const branchConditions: any[] = [tenantWhere(biometricDevices, ctx)];
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
    tenantWhere(members, ctx),
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
    const targetGroup = await calculateMemberAccessGroup(ctx, m.id);
    if (targetGroup === 1) group1ActiveCount++;
    else group99DeniedCount++;

    // Reconciliation is idempotent. Only queue when the device is not already
    // confirmed in the calculated target group.
    const result = await syncMemberBiometricAccessService(ctx, m.id, { explicitGroup: targetGroup });
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
  ctx: TenantContext,
  branchId: string,
  memberId: string,
  pin: string,
  name: string,
  accessGroup?: number
) {
  return syncMemberBiometricAccessService(ctx, memberId, {
    force: true,
    explicitPin: pin,
    explicitName: name,
    explicitGroup: accessGroup,
    explicitBranchId: branchId,
  });
}

export async function deleteBiometricIdentityService(ctx: TenantContext, identityId: string) {
  const [identity] = await db.select().from(biometricIdentities).where(eq(biometricIdentities.id, identityId)).limit(1);
  if (!identity) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Identity not found');

  const [device] = await db.select().from(biometricDevices).where(and(eq(biometricDevices.id, identity.deviceId), tenantWhere(biometricDevices, ctx))).limit(1);
  if (!device) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Device not found');

  // Queue a command to delete the user from the physical device
  await db.insert(biometricDeviceCommands).values({
    organizationId: ctx.organizationId,
    deviceId: device.id,
    deviceSerial: device.serialNumber,
    commandString: `DATA DELETE USERINFO PIN=${identity.deviceUserId}`,
    status: 'PENDING',
  });

  // Delete the local identity mapping
  await db.delete(biometricIdentities).where(eq(biometricIdentities.id, identityId));
  return { success: true };
}
