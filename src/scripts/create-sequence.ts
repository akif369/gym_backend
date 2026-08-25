import { sql } from 'drizzle-orm';
import { db } from '../db/index';

async function main() {
  try {
    await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS biometric_adms_command_id_seq;`);
    console.log('Sequence created successfully.');
  } catch (err) {
    console.error('Error creating sequence:', err);
  }
  process.exit(0);
}

main();
