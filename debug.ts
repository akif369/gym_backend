import { db } from './src/db/db';
import { biometricDevices } from './src/db/schema';
import { branches } from './src/db/schema';
import { members } from './src/db/schema';
import { biometricIdentities } from './src/db/schema';

async function run() {
  const devs = await db.select().from(biometricDevices);
  console.log('Devices:', devs);
  
  const br = await db.select().from(branches);
  console.log('Branches:', br);
  
  const mems = await db.select().from(members).orderBy(members.createdAt);
  console.log('Members:', mems.slice(-3).map(m => ({ id: m.id, name: m.firstName, branchId: m.branchId })));
  
  const ids = await db.select().from(biometricIdentities);
  console.log('Identities:', ids);
  
  process.exit(0);
}

run().catch(console.error);
