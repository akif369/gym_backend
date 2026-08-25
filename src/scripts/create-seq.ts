import * as dotenv from 'dotenv';
dotenv.config();

import { db } from '../db/index';
import { sql } from 'drizzle-orm';

async function createSequence() {
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS biometric_adms_command_id_seq;`);
  console.log('Sequence created');
  process.exit(0);
}

createSequence().catch(console.error);
