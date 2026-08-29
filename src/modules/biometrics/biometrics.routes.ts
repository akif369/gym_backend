import { FastifyInstance } from 'fastify';
import {
  admsRegistry,
  admsCdata,
  admsGetRequest,
  admsDeviceCmd,
  listDevices,
  biometricHealth,
  listIdentities,
  registerDevice,
  deleteDevice,
  syncMemberToDevice,
  syncMemberAccess,
  reconcileBiometrics,
  deleteIdentity,
} from './biometrics.controller';
import { requireAuth } from '../../common/auth/requireAuth';

/** F09 ADMS protocol endpoints. Devices authenticate by their registered serial number. */
export async function biometricsAdmsRoutes(app: FastifyInstance) {
  app.post('/registry', admsRegistry);
  app.get('/registry', admsRegistry);
  app.post('/cdata', admsCdata);
  app.get('/cdata', admsCdata);
  app.get('/getrequest', admsGetRequest);
  app.post('/devicecmd', admsDeviceCmd);
}

export async function biometricsApiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', listDevices);
  app.get('/health', biometricHealth);
  app.get('/identities', listIdentities);
  app.post('/', registerDevice);
  app.delete('/:deviceId', deleteDevice);
  app.delete('/identities/:identityId', deleteIdentity);
  app.post('/sync', syncMemberToDevice);
  app.post('/sync-member/:memberId', syncMemberAccess);
  app.post('/reconcile', reconcileBiometrics);
}
