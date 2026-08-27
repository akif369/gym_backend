import { reconcileBiometricAccessService } from './src/modules/biometrics/biometrics.service';

async function run() {
  const orgId = 'b462fa38-3f4a-4081-a52b-959a57aa24b7';
  
  const result = await reconcileBiometricAccessService(orgId);
  console.log('Reconciliation result:', result);
  
  process.exit(0);
}

run();
