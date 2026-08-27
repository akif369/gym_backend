import { db } from './src/db/index';
import { biometricDevices } from './src/db/schema/index';

async function run() {
  const devices = await db.select().from(biometricDevices);
  console.log(JSON.stringify(devices, null, 2));
  process.exit(0);
}

run();
