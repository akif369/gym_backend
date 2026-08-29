import { createLogger } from '../../common/logger/index';
import { config } from '../../config/env';
import { expireDueMembershipsService, sweepInactiveMembersService } from './memberships.service';
import { runDeviceAccessSyncWorker } from '../biometrics/biometrics.service';
import { startStaggeredRecurring } from '../../common/scheduler/staggeredRecurring';

const log = createLogger('membership-expiry-scheduler');

export function startMembershipExpiryScheduler() {
  const runExpiry = async () => {
    try {
      const result = await expireDueMembershipsService(config.membershipExpiryBatchSize);
      if (result.expired > 0) log.info(result, 'Expired memberships processed');
    } catch (error) {
      log.error({ err: error }, 'Membership expiry sweep failed');
    }
  };

  const runInactive = async () => {
    try {
      const result = await sweepInactiveMembersService(config.inactiveMemberSweepBatchSize);
      if (result.inactiveMarked > 0) log.info(result, 'Inactive members processed');
    } catch (error) {
      log.error({ err: error }, 'Inactive member sweep failed');
    }
  };

  const runBiometricWorker = async () => {
    try {
      const result = await runDeviceAccessSyncWorker();
      if (result.queued > 0 || result.recovered > 0 || result.cancelled > 0 || result.offlineMarked > 0 || result.permanentlyFailed > 0) {
        log.info(result, 'Biometric desired-state work processed');
      }
      if (result.permanentlyFailed > 0) {
        log.warn(result, 'Biometric commands reached their retry limit');
      }
    } catch (error) {
      log.error({ err: error }, 'Biometric sync worker failed');
    }
  };

  const stopExpiry = startStaggeredRecurring(
    runExpiry,
    config.membershipExpirySweepIntervalMs,
    config.schedulerStartupJitterMs,
  );
  const stopInactive = startStaggeredRecurring(
    runInactive,
    config.inactiveMemberSweepIntervalMs,
    config.schedulerStartupJitterMs,
  );
  const stopBiometricWorker = startStaggeredRecurring(
    runBiometricWorker,
    config.biometricSyncWorkerIntervalMs,
    config.schedulerStartupJitterMs,
  );

  return () => {
    stopExpiry();
    stopInactive();
    stopBiometricWorker();
  };
}
