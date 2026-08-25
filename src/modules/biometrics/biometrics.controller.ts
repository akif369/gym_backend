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
} from './biometrics.service';
import { db } from '../../db/index';
import { biometricDevices, biometricDeviceCommands } from '../../db/schema/biometrics.schema';
import { and, eq } from 'drizzle-orm';
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

export async function admsGetRequest(
  req: FastifyRequest,
  reply: FastifyReply
) {
  console.log('\n');
  console.log('########################################');
  console.log('### F09 GETREQUEST RECEIVED');
  console.log('########################################');

  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query:', req.query);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);

  const query =
    (req.query as Record<string, any>) ?? {};

  const sn = String(
    query.SN ??
    query.sn ??
    ''
  ).trim();

  console.log('Extracted SN:', JSON.stringify(sn));

  if (!sn) {
    console.error(
      '❌ GETREQUEST HAS NO SERIAL NUMBER'
    );

    return reply
      .type('text/plain')
      .send('OK\n');
  }

  console.log(
    'Calling processAdmsGetRequest()...'
  );

  const response =
    await processAdmsGetRequest(sn);

  console.log(
    'processAdmsGetRequest response:',
    JSON.stringify(response)
  );

  console.log(
    '########################################'
  );
  console.log(
    '### END GETREQUEST'
  );
  console.log(
    '########################################\n'
  );

  return reply
    .type('text/plain')
    .send(response);
}

export async function admsDeviceCmd(
  req: FastifyRequest,
  reply: FastifyReply
) {
  console.log('\n');
  console.log('##############################################');
  console.log('🔥 /iclock/devicecmd HIT');
  console.log('##############################################');
  console.log('METHOD:', req.method);
  console.log('URL:', req.url);
  console.log('QUERY:', req.query);
  console.log('HEADERS:', req.headers);
  console.log('BODY:', req.body);

  const query = (req.query as Record<string, unknown>) ?? {};
  const sn = String(
    query.SN ?? ''
  ).trim();

  console.log('SN:', sn);

  /*
   * Fastify may parse application/x-www-form-urlencoded
   * into an object.
   */
  let raw = '';
  if (typeof req.body === 'string') {
    raw = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    raw = req.body.toString('utf8');
  } else if (
    req.body && typeof req.body === 'object'
  ) {
    const body = req.body as Record<string, unknown>;
    raw = Object.entries(body)
      .map(
        ([key, value]) =>
          `${key}=${encodeURIComponent(
            String(value ?? '')
          )}`
      )
      .join('&');
  }

  console.log('RAW DEVICECMD BODY:');
  console.log(JSON.stringify(raw));

  /*
   * Some firmware may put values in the query.
   */
  if (!raw) {
    raw = Object.entries(query)
      .filter(([key]) => key !== 'SN')
      .map(
        ([key, value]) =>
          `${key}=${encodeURIComponent(
            String(value ?? '')
          )}`
      )
      .join('&');
  }

  console.log(
    'FINAL DEVICECMD PAYLOAD:',
    JSON.stringify(raw)
  );

  // Use the shared ADMS acknowledgement handler so successful commands also
  // mark the identity SYNCED and persist the confirmed access group.
  await processAdmsDeviceCmd(sn, raw);
  return reply
    .type('text/plain')
    .send('OK\n');

  /*
   * Parse ID / Return / CMD.
   *
   * IMPORTANT:
   * ZKTeco uses Return with either capitalization
   * depending on firmware.
   */
  const params = new URLSearchParams(
    raw
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n/g, '&')
  );

  const idValue = params.get('ID');
  const returnValue = params.get('Return') ?? params.get('return');
  const cmdValue = params.get('CMD') ?? params.get('cmd');

  console.log('PARSED DEVICECMD:');
  console.log({
    SN: sn,
    ID: idValue,
    Return: returnValue,
    CMD: cmdValue,
  });

  if (!sn) {
    console.error(
      '❌ DEVICECMD: missing SN'
    );
    return reply
      .type('text/plain')
      .send('OK\n');
  }

  if (!idValue) {
    console.error(
      '❌ DEVICECMD: missing ID'
    );
    return reply
      .type('text/plain')
      .send('OK\n');
  }

  const admsCommandId = Number(idValue);
  const returnCode = Number(
    returnValue ?? -999
  );

  console.log(
    'ADMS COMMAND ID:',
    admsCommandId
  );
  console.log(
    'RETURN CODE:',
    returnCode
  );

  /*
   * Find exact command.
   */
  const [command] = await db
    .select()
    .from(
      biometricDeviceCommands
    )
    .where(
      and(
        eq(
          biometricDeviceCommands.admsCommandId,
          admsCommandId
        ),
        eq(
          biometricDeviceCommands.deviceSerial,
          sn
        )
      )
    )
    .limit(1);

  if (!command) {
    console.error(
      '❌ DEVICECMD: command NOT FOUND'
    );
    console.error({
      sn,
      admsCommandId,
      returnCode,
      cmdValue,
    });

    /*
     * VERY useful diagnostic:
     */
    const [byId] = await db
      .select()
      .from(
        biometricDeviceCommands
      )
      .where(
        eq(
          biometricDeviceCommands.admsCommandId,
          admsCommandId
        )
      )
      .limit(1);
    console.error(
      'Found by ADMS ID only:',
      byId
    );

    return reply
      .type('text/plain')
      .send('OK\n');
  }

  // TypeScript cannot infer narrowing through Fastify's reply object above.
  if (!command) throw new Error('ADMS command disappeared after lookup');

  console.log(
    '✓ MATCHED COMMAND:',
    command!.id
  );
  console.log(
    'Original command:',
    command!.commandString
  );

  /*
   * Return 0 = SUCCESS
   */
  if (returnCode === 0) {
    await db
      .update(
        biometricDeviceCommands
      )
      .set({
        status: 'COMPLETED',
        completedAt: new Date(),
      })
      .where(
        eq(
          biometricDeviceCommands.id,
          command!.id
        )
      );
    console.log(
      '🎉 COMMAND COMPLETED'
    );
  } else {
    await db
      .update(
        biometricDeviceCommands
      )
      .set({
        status: 'FAILED',
        completedAt: new Date(),
      })
      .where(
        eq(
          biometricDeviceCommands.id,
          command!.id
        )
      );
    console.error(
      '❌ DEVICE REPORTED FAILURE'
    );
    console.error(
      'Return code:',
      returnCode
    );
  }

  return reply
    .type('text/plain')
    .send('OK\n');
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
  const { memberId, pin, name, branchId, accessGroup } = req.body as any;
  const result = await syncMemberToBiometricsService(orgId, branchId, memberId, pin, name, accessGroup);
  return reply.send(result);
}

export async function syncMemberAccess(req: FastifyRequest, reply: FastifyReply) {
  const orgId = req.user.orgId;
  const { memberId } = req.params as any;
  const result = await syncMemberBiometricAccessService(orgId, memberId, { force: true });
  return reply.send(result);
}

export async function reconcileBiometrics(req: FastifyRequest, reply: FastifyReply) {
  const orgId = req.user.orgId;
  const { branchId } = (req.body as any) || {};
  const result = await reconcileBiometricAccessService(orgId, branchId);
  return reply.send(result);
}
