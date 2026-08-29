import { FastifyRequest, FastifyReply } from 'fastify';
import {
  processAdmsAttendance,
  processAdmsGetRequest,
  processAdmsDeviceCmd,
  listDevicesService,
  listIdentitiesService,
  registerDeviceService,
  deleteDeviceService,
  syncMemberToBiometricsService,
  syncMemberBiometricAccessService,
  reconcileBiometricAccessService,
  deleteBiometricIdentityService,
  getBiometricHealthService,
} from './biometrics.service';
import { db } from '../../db/index';
import { biometricDevices } from '../../db/schema/biometrics.schema';
import { eq } from 'drizzle-orm';
import { createLogger } from '../../common/logger/index';

const log = createLogger('biometrics-controller');

function admsPayloadFromBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof body === 'object') {
    return Object.entries(body as Record<string, unknown>)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value ?? ''))}`)
      .join('&');
  }
  return '';
}

// --- ADMS Endpoints ---

export async function admsRegistry(req: FastifyRequest, reply: FastifyReply) {
  const sn = String((req.query as Record<string, unknown>).SN ?? '').trim();
  if (!sn) return reply.status(400).type('text/plain').send('Registry Failed: No SN');

  const [device] = await db.select({ id: biometricDevices.id })
    .from(biometricDevices)
    .where(eq(biometricDevices.serialNumber, sn))
    .limit(1);
  if (device) {
    await db.update(biometricDevices)
      .set({ lastSeenAt: new Date(), status: 'ONLINE', ipAddress: req.ip, updatedAt: new Date() })
      .where(eq(biometricDevices.id, device.id));
    log.info({ deviceSn: sn, ip: req.ip }, 'ADMS device registered');
  } else {
    log.warn({ deviceSn: sn, ip: req.ip }, 'Unregistered ADMS device attempted registry');
  }

  return reply.type('text/plain').send('Registry=OK\n');
}

export async function admsCdata(req: FastifyRequest, reply: FastifyReply) {
  const sn = String((req.query as Record<string, unknown>).SN ?? '').trim();
  if (!sn) return reply.type('text/plain').send('OK\n');

  const payload = admsPayloadFromBody(req.body);
  if (payload && req.method === 'POST') {
    await processAdmsAttendance(sn, payload);
  } else if (req.method === 'GET') {
    await db.update(biometricDevices)
      .set({ lastSeenAt: new Date(), status: 'ONLINE', updatedAt: new Date() })
      .where(eq(biometricDevices.serialNumber, sn));
  }

  return reply.type('text/plain').send('OK\n');
}

export async function admsGetRequest(req: FastifyRequest, reply: FastifyReply) {
  const query = (req.query as Record<string, unknown>) ?? {};
  const sn = String(query.SN ?? query.sn ?? '').trim();
  if (!sn) {
    log.warn({ ip: req.ip }, 'ADMS getrequest missing serial number');
    return reply.type('text/plain').send('OK\n');
  }

  const response = await processAdmsGetRequest(sn);
  return reply.type('text/plain').send(response);
}

export async function admsDeviceCmd(req: FastifyRequest, reply: FastifyReply) {
  const query = (req.query as Record<string, unknown>) ?? {};
  const sn = String(query.SN ?? query.sn ?? '').trim();
  if (!sn) {
    log.warn({ ip: req.ip }, 'ADMS devicecmd missing serial number');
    return reply.type('text/plain').send('OK\n');
  }

  let payload = admsPayloadFromBody(req.body);
  if (!payload) {
    payload = Object.entries(query)
      .filter(([key]) => key.toLowerCase() !== 'sn')
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value ?? ''))}`)
      .join('&');
  }
  await processAdmsDeviceCmd(sn, payload);
  return reply.type('text/plain').send('OK\n');
}

// --- API Endpoints for UI ---

export async function listDevices(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ data: await listDevicesService(req.user) });
}

export async function biometricHealth(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ data: await getBiometricHealthService(req.user) });
}

export async function listIdentities(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ data: await listIdentitiesService(req.user) });
}

export async function registerDevice(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ data: await registerDeviceService(req.user, req.body as any) });
}

export async function deleteDevice(req: FastifyRequest, reply: FastifyReply) {
  await deleteDeviceService(req.user, (req.params as { deviceId: string }).deviceId);
  return reply.status(204).send();
}

export async function deleteIdentity(req: FastifyRequest, reply: FastifyReply) {
  await deleteBiometricIdentityService(req.user, (req.params as { identityId: string }).identityId);
  return reply.status(204).send();
}

export async function syncMemberToDevice(req: FastifyRequest, reply: FastifyReply) {
  const { memberId, pin, name, branchId, accessGroup } = req.body as any;
  return reply.send(await syncMemberToBiometricsService(req.user, branchId, memberId, pin, name, accessGroup));
}

export async function syncMemberAccess(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await syncMemberBiometricAccessService(req.user, (req.params as { memberId: string }).memberId, { force: true }));
}

export async function reconcileBiometrics(req: FastifyRequest, reply: FastifyReply) {
  const { branchId } = (req.body as { branchId?: string } | undefined) ?? {};
  return reply.send(await reconcileBiometricAccessService(req.user, branchId));
}
