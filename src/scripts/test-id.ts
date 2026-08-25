import * as dotenv from 'dotenv';
dotenv.config();

import { db } from '../db/index';
import { sql } from 'drizzle-orm';

async function testGetNextAdmsCommandId(): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT COALESCE(MAX(adms_command_id), 0) + 1 AS next_id
      FROM biometric_device_commands
    `);
    console.log('Result type:', typeof result);
    console.log('Result:', result);
    // @ts-ignore
    return Number((result as any)[0]?.next_id ?? (result.rows && result.rows[0]?.next_id) ?? 1);
  } catch (err: any) {
    console.error('Error in getNextAdmsCommandId:', err.message);
    throw err;
  }
}

testGetNextAdmsCommandId().then(id => {
  console.log('Next ID:', id);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
