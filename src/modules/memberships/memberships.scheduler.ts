import { createLogger } from '../../common/logger/index';
import { config } from '../../config/env';
import { expireDueMembershipsService, sweepInactiveMembersService } from './memberships.service';
import { runDeviceAccessSyncWorker } from '../biometrics/biometrics.service';

const log = createLogger('membership-expiry-scheduler');

export function startMembershipExpiryScheduler() {
  const run = async () => {
    try {
      const result = await expireDueMembershipsService();
      if (result.expired > 0) log.info(result, 'Expired memberships processed');
      
      const inactiveResult = await sweepInactiveMembersService();
      if (inactiveResult.inactiveMarked > 0) log.info(inactiveResult, 'Inactive members processed');

      const deviceResult = await runDeviceAccessSyncWorker();
      if (deviceResult.queued > 0 || deviceResult.recovered > 0) {
        log.info(deviceResult, 'Biometric desired-state work processed');
      }

    } catch (error) {
      log.error({ err: error }, 'Membership expiry sweep failed');
    }
  };

  void run();
  const timer = setInterval(() => void run(), config.membershipExpirySweepIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
