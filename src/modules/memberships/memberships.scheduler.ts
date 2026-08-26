import { createLogger } from '../../common/logger/index';
import { config } from '../../config/env';
import { expireDueMembershipsService, sweepInactiveMembersService } from './memberships.service';
import { reconcileBiometricAccessService } from '../biometrics/biometrics.service';
import { db } from '../../db/index';
import { organizations } from '../../db/schema/org.schema';

const log = createLogger('membership-expiry-scheduler');

export function startMembershipExpiryScheduler() {
  const run = async () => {
    try {
      const result = await expireDueMembershipsService();
      if (result.expired > 0) log.info(result, 'Expired memberships processed');
      
      const inactiveResult = await sweepInactiveMembersService();
      if (inactiveResult.inactiveMarked > 0) log.info(inactiveResult, 'Inactive members processed');

      // Repair missed events and reconcile all existing identities. The
      // reconciliation service uses delta checks, so already-confirmed users
      // do not generate duplicate commands.
      // 
      // DISABLED: User explicitly requested to disable automatic sync for now
      /*
      const orgs = await db.select({ id: organizations.id }).from(organizations);
      for (const org of orgs) {
        const syncResult = await reconcileBiometricAccessService(org.id);
        if (syncResult.commandsQueued > 0) {
          log.info({ organizationId: org.id, ...syncResult }, 'Biometric access reconciliation queued updates');
        }
      }
      */
    } catch (error) {
      log.error({ err: error }, 'Membership expiry sweep failed');
    }
  };

  void run();
  const timer = setInterval(() => void run(), config.membershipExpirySweepIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
