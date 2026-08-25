import { FastifyInstance } from 'fastify';
import { admsRegistry, admsCdata, admsGetRequest, admsDeviceCmd, listDevices, listIdentities, registerDevice, deleteDevice, syncMemberToDevice } from './biometrics.controller';
import { requireAuth } from '../../common/auth/requireAuth';

export async function biometricsAdmsRoutes(app: FastifyInstance) {
  // ADMS routes must NOT have requireAuth, because devices use their own protocol
  // Depending on device settings, these could be at root or under /iclock
  
  // Note: Drizzle / Fastify allows GET/POST on same route path.
  app.post('/registry', admsRegistry);
  app.get('/registry', admsRegistry); // some firmwares use GET
  
  app.post('/cdata', {
    // ADMS often sends text/plain or raw payload, we need to parse it as text
    config: { rawBody: true }
  }, admsCdata);
  app.get('/cdata', admsCdata);
  
  app.get('/getrequest', admsGetRequest);
  app.post('/devicecmd', admsDeviceCmd);
}

export async function biometricsApiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', listDevices);
  app.get('/identities', listIdentities);
  app.post('/', registerDevice);
  app.delete('/:deviceId', deleteDevice);
  app.post('/sync', syncMemberToDevice);
}
