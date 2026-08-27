import { db } from './src/db/index';
import { getMemberAccessStatusService } from './src/modules/members/members.service';
import { calculateMemberAccessGroup, reconcileBiometricAccessService } from './src/modules/biometrics/biometrics.service';

async function run() {
  const orgId = 'b462fa38-3f4a-4081-a52b-959a57aa24b7';
  const memberId = 'f9d96f98-a619-44db-9967-51f829d4c4b3'; // Rahul Sharma
  
  const status = await getMemberAccessStatusService(orgId, memberId);
  console.log('STATUS:', status);

  const group = await calculateMemberAccessGroup(orgId, memberId);
  console.log('GROUP:', group);
  
  const result = await reconcileBiometricAccessService(orgId);
  console.log('Reconciliation result:', result);

  process.exit(0);
}

run();
