import { FastifyRequest, FastifyReply } from 'fastify';
import { processAdmsAttendance, processAdmsGetRequest, processAdmsDeviceCmd, listDevicesService, listIdentitiesService, registerDeviceService, deleteDeviceService, syncMemberToBiometricsService } from './biometrics.service';
import { db } from '../../db/index';
import { biometricDevices } from '../../db/schema/biometrics.schema';
import { eq } from 'drizzle-orm';
import { createLogger } from '../../common/logger/index';

const log = createLogger('biometrics-controller');

// --- ADMS Endpoints ---

export async function admsRegistry(req: FastifyRequest, reply: FastifyReply) {
  const sn = (req.query as any).SN;
  if (!sn) {
    return reply.status(400).send('Registry Failed: No SN');
  }

  const [device] = await db.select().from(biometricDevices).where(eq(biometricDevices.serialNumber, sn)).limit(1);
  if (device) {
    await db.update(biometricDevices).set({ lastSeenAt: new Date(), status: 'ONLINE', ipAddress: req.ip }).where(eq(biometricDevices.id, device.id));
    log.info({ sn, ip: req.ip }, 'Device registry successful');
  } else {
    log.warn({ sn, ip: req.ip }, 'Unregistered device attempted registry');
  }

  reply.header('Content-Type', 'text/plain');
  return reply.send('Registry=OK\n');
}

export async function admsCdata(req: FastifyRequest, reply: FastifyReply) {
  const sn = (req.query as any).SN;
  if (!sn) {
    return reply.status(400).send('OK');
  }

  const payload = req.body as string;
  if (payload && req.method === 'POST') {
    await processAdmsAttendance(sn, payload);
  } else if (req.method === 'GET') {
    // Some older devices use GET to init Cdata
    const [device] = await db.select().from(biometricDevices).where(eq(biometricDevices.serialNumber, sn)).limit(1);
    if (device) {
      await db.update(biometricDevices).set({ lastSeenAt: new Date(), status: 'ONLINE' }).where(eq(biometricDevices.id, device.id));
    }
  }

  reply.header('Content-Type', 'text/plain');
  return reply.send('OK\n');
}

export async function admsGetRequest(req: FastifyRequest, reply: FastifyReply) {
  const sn = (req.query as any).SN;
  if (!sn) {
    return reply.status(400).send('OK');
  }
  const cmd = await processAdmsGetRequest(sn);
  reply.header('Content-Type', 'text/plain');
  return reply.send(cmd + '\n');
}

export async function admsDeviceCmd(req: FastifyRequest, reply: FastifyReply) {
  const sn = (req.query as any).SN;
  const payload = req.body as string;
  if (sn && payload) {
    await processAdmsDeviceCmd(sn, payload);
  }
  reply.header('Content-Type', 'text/plain');
  return reply.send('OK\n');
}

// --- API Endpoints for UI ---

export async function listDevices(req: FastifyRequest, reply: FastifyReply) {
  const orgId = req.user.orgId;
  const devices = await listDevicesService(orgId);
  return reply.send({ data: devices });
}

export async function listIdentities(req: FastifyRequest, reply: FastifyReply) {
  const orgId = req.user.orgId;
  const identities = await listIdentitiesService(orgId);
  return reply.send({ data: identities });
}

export async function registerDevice(req: FastifyRequest, reply: FastifyReply) {
  const orgId = req.user.orgId;
  const data = req.body as any;
  const device = await registerDeviceService(orgId, data);
  return reply.send({ data: device });
}

export async function deleteDevice(req: FastifyRequest, reply: FastifyReply) {
  const orgId = req.user.orgId;
  const { deviceId } = req.params as any;
  await deleteDeviceService(orgId, deviceId);
  return reply.status(204).send();
}

export async function syncMemberToDevice(req: FastifyRequest, reply: FastifyReply) {
  const orgId = req.user.orgId;
  const { memberId, pin, name, branchId } = req.body as any;
  const result = await syncMemberToBiometricsService(orgId, branchId, memberId, pin, name);
  return reply.send(result);
}
