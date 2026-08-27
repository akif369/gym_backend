import { db } from './src/db/index';
import { members, memberMemberships, biometricIdentities } from './src/db/schema/index';
import { eq } from 'drizzle-orm';

async function run() {
  const ms = await db.select().from(members).where(eq(members.memberNumber, 'GYM0001'));
  if (ms.length === 0) return console.log('Member not found');
  const mems = await db.select().from(memberMemberships).where(eq(memberMemberships.memberId, ms[0].id));
  const bios = await db.select().from(biometricIdentities).where(eq(biometricIdentities.memberId, ms[0].id));
  console.log(JSON.stringify({ members: ms, memberships: mems, identities: bios }, null, 2));
  process.exit(0);
}

run();
