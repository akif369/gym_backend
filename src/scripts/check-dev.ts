import * as dotenv from 'dotenv';
dotenv.config();
import { db } from '../db/index';
import { biometricDevices, members, biometricIdentities } from '../db/schema/index';
import { eq } from 'drizzle-orm';

async function check() {
  const allDevices = await db.select().from(biometricDevices);
  console.log('Devices:', allDevices);
  
  const rahul = await db.select().from(members).where(eq(members.firstName, 'Rahul')).limit(1);
  console.log('Rahul branch:', rahul[0]?.branchId);
  
  const idents = await db.select().from(biometricIdentities).where(eq(biometricIdentities.deviceUserId, '1'));
  console.log('Idents:', idents);
}

check().then(() => process.exit(0)).catch(e => console.error(e));
