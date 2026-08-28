import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

async function resetDb() {
  console.log('Resetting database...');
  await sql`DROP SCHEMA IF EXISTS public CASCADE;`;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE;`;
  await sql`CREATE SCHEMA public;`;
  console.log('Database reset successfully.');
  process.exit(0);
}

resetDb().catch(console.error);
