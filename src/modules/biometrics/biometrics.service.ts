import { db } from '../../db/index';
import { biometricDevices, biometricEvents, biometricIdentities, biometricDeviceCommands } from '../../db/schema/biometrics.schema';
import { attendanceLogs } from '../../db/schema/attendance.schema';
import { members } from '../../db/schema/members.schema';
import { eq, and, desc, asc, ne, isNull } from 'drizzle-orm';
import { createLogger } from '../../common/logger/index';
import crypto from 'crypto';
import { AppError, ErrorCode } from '../../common/errors/AppError';

const log = createLogger('biometrics-service');

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
    if (parts.length < 4) continue;

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

    if (identity?.memberId) {
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
                .set({ checkOutAt: eventTime, checkOutMethod: 'BIOMETRIC' })
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

export async function processAdmsGetRequest(deviceSn: string) {
  const [device] = await db.select().from(biometricDevices).where(eq(biometricDevices.serialNumber, deviceSn)).limit(1);
  if (!device) return 'OK';

  // Mark device online
  await db.update(biometricDevices).set({ lastSeenAt: new Date(), status: 'ONLINE' }).where(eq(biometricDevices.id, device.id));

  // Get oldest PENDING command
  const [command] = await db.select()
    .from(biometricDeviceCommands)
    .where(and(eq(biometricDeviceCommands.deviceId, device.id), eq(biometricDeviceCommands.status, 'PENDING')))
    .orderBy(asc(biometricDeviceCommands.createdAt))
    .limit(1);

  if (!command) return 'OK';

  // Mark as SENT
  await db.update(biometricDeviceCommands)
    .set({ status: 'SENT', sentAt: new Date() })
    .where(eq(biometricDeviceCommands.id, command.id));

  // Return formatted command for ADMS: "C:<id>:<commandString>"
  return `C:${command.id}:${command.commandString}`;
}

export async function processAdmsDeviceCmd(deviceSn: string, payload: string) {
  // Payload format is usually "ID=ReturnCode" e.g. "ID=1&Return=0" or tab separated
  // We'll parse it out roughly
  const params = new URLSearchParams(payload);
  const cmdId = params.get('ID');
  const returnCode = params.get('Return'); // usually 0 for success

  if (cmdId) {
    const status = returnCode === '0' ? 'COMPLETED' : 'FAILED';
    await db.update(biometricDeviceCommands)
      .set({ status, completedAt: new Date() })
      .where(eq(biometricDeviceCommands.id, cmdId as any));
  }
}

// Service methods for WebApp UI

export async function listDevicesService(orgId: string) {
  return db.select().from(biometricDevices).where(eq(biometricDevices.organizationId, orgId)).orderBy(desc(biometricDevices.createdAt));
}

export async function listIdentitiesService(orgId: string) {
  return db.select({
    memberId: biometricIdentities.memberId,
    deviceId: biometricIdentities.deviceId,
    deviceUserId: biometricIdentities.deviceUserId,
  }).from(biometricIdentities)
    .innerJoin(members, eq(members.id, biometricIdentities.memberId))
    .where(eq(members.organizationId, orgId));
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

// Manual or Auto Sync Member to Devices
export async function syncMemberToBiometricsService(orgId: string, branchId: string, memberId: string, pin: string, name: string) {
  // Find all access control devices for this branch
  const devices = await db.select()
    .from(biometricDevices)
    .where(eq(biometricDevices.branchId, branchId));

  if (devices.length === 0) throw AppError.badRequest(ErrorCode.BAD_REQUEST, 'No biometric devices found for this branch');

  for (const d of devices) {
    const [conflict] = await db.select().from(biometricIdentities)
      .where(and(
        eq(biometricIdentities.deviceId, d.id),
        eq(biometricIdentities.deviceUserId, pin),
        ne(biometricIdentities.memberId, memberId)
      )).limit(1);
      
    if (conflict) {
      throw AppError.badRequest(ErrorCode.BAD_REQUEST, `PIN ${pin} is already assigned to another member on device ${d.deviceName}. Each member must have a unique PIN.`);
    }
  }

  const commandsToInsert = devices.map(d => {
    return {
      organizationId: orgId,
      deviceId: d.id,
      deviceSerial: d.serialNumber,
      // F09 ADMS DATA UPDATE format: DATA UPDATE USER PIN=1001 Name=John\tPrivilege=0
      commandString: `DATA UPDATE USER PIN=${pin}\tName=${name}\tPrivilege=0`,
      status: 'PENDING' as const,
    };
  });

  if (commandsToInsert.length > 0) {
    await db.insert(biometricDeviceCommands).values(commandsToInsert);
    
    // Also store identity mappings if they don't exist
    for (const d of devices) {
      const [existing] = await db.select().from(biometricIdentities).where(and(eq(biometricIdentities.deviceId, d.id), eq(biometricIdentities.memberId, memberId))).limit(1);
      if (!existing) {
        await db.insert(biometricIdentities).values({
          memberId,
          deviceId: d.id,
          deviceUserId: pin,
        });
      } else if (existing.deviceUserId !== pin) {
        await db.update(biometricIdentities).set({ deviceUserId: pin }).where(eq(biometricIdentities.id, existing.id));
      }
    }
  }

  return { success: true, count: commandsToInsert.length };
}
